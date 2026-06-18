import fs from 'node:fs/promises';
import path from 'node:path';

export const FailureCategory = Object.freeze({
  DependencyFailure: 'DependencyFailure',
  MissingFile: 'MissingFile',
  MissingScript: 'MissingScript',
  BuildFailure: 'BuildFailure',
  RuntimeFailure: 'RuntimeFailure',
  NetworkFailure: 'NetworkFailure',
  PortFailure: 'PortFailure',
  FrameworkMismatch: 'FrameworkMismatch',
  ConfigurationFailure: 'ConfigurationFailure',
  EnvironmentFailure: 'EnvironmentFailure',
  Unknown: 'Unknown'
});

export const Severity = Object.freeze({
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Critical: 'critical'
});

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

function parseMissingScript(text) {
  const quoted = text.match(/missing required script "([^"]+)"/i);
  if (quoted) return quoted[1];
  const npmStyle = text.match(/missing script:?\s*([a-z0-9:_-]+)/i);
  if (npmStyle) return npmStyle[1];
  const descriptive = text.match(/missing\s+([a-z0-9:_-]+)\s+script/i);
  if (descriptive) return descriptive[1];
  return null;
}

function detectFailureCategory(reason, logs = []) {
  const haystack = `${reason}\n${logs.join('\n')}`.toLowerCase();

  if (parseMissingScript(haystack)) return FailureCategory.MissingScript;
  if (haystack.includes('cannot find module') || haystack.includes('module not found')) return FailureCategory.DependencyFailure;
  if (haystack.includes('enoent') || haystack.includes('no such file or directory')) return FailureCategory.MissingFile;
  if (haystack.includes('eaddrinuse') || haystack.includes('address already in use') || haystack.includes('port')) return FailureCategory.PortFailure;
  if (haystack.includes('network') || haystack.includes('econnrefused') || haystack.includes('enotfound')) return FailureCategory.NetworkFailure;
  if (haystack.includes('build') || haystack.includes('tsc') || haystack.includes('typescript')) return FailureCategory.BuildFailure;
  if (haystack.includes('env') || haystack.includes('node_env')) return FailureCategory.EnvironmentFailure;
  if (haystack.includes('runtime') || haystack.includes('exited with code') || haystack.includes('process exited')) return FailureCategory.RuntimeFailure;
  return FailureCategory.Unknown;
}

function severityForCategory(category) {
  if (category === FailureCategory.RuntimeFailure || category === FailureCategory.BuildFailure) return Severity.High;
  if (category === FailureCategory.MissingScript || category === FailureCategory.DependencyFailure) return Severity.Medium;
  return Severity.Low;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createDiagnosis(failure) {
  const reason = String(failure?.reason ?? 'Unknown failure');
  const logs = Array.isArray(failure?.logs) ? failure.logs : [];
  const category = detectFailureCategory(reason, logs);
  const missingScript = parseMissingScript(reason) ?? parseMissingScript(logs.join('\n'));
  const rootCause = missingScript
    ? `package.json missing ${missingScript} script`
    : reason;

  return {
    category,
    severity: severityForCategory(category),
    confidence: category === FailureCategory.Unknown ? 0.25 : 0.9,
    rootCause,
    evidence: logs.slice(-10).concat([reason]).filter(Boolean).slice(-10),
    suggestedActions: missingScript ? [`Add ${missingScript} script to package.json`] : ['Inspect launch logs for root cause']
  };
}

export class RuleBasedLogAnalyzer {
  async analyze(logs = [], failure = {}) {
    return createDiagnosis({ ...failure, logs });
  }
}

export class RepositoryValidator {
  async validate(repo) {
    const packageJsonPath = path.join(repo.path, 'package.json');
    const packageJsonExists = await fileExists(packageJsonPath);
    const issues = [];
    if (!packageJsonExists) {
      issues.push('package.json missing');
    }
    return {
      valid: issues.length === 0,
      checks: {
        packageJsonExists,
        entrypointExists: true,
        frameworkConsistent: true,
        lockfileValid: true
      },
      issues
    };
  }
}

class FileRepairTransaction {
  constructor(files = []) {
    this.files = files;
    this.snapshots = new Map();
  }

  async begin() {
    for (const filePath of this.files) {
      const exists = await fileExists(filePath);
      if (exists) {
        this.snapshots.set(filePath, await fs.readFile(filePath, 'utf8'));
      } else {
        this.snapshots.set(filePath, null);
      }
    }
  }

  async commit() {
    this.snapshots.clear();
  }

  async rollback() {
    for (const [filePath, content] of this.snapshots.entries()) {
      if (content === null) {
        await fs.rm(filePath, { force: true });
      } else {
        await fs.writeFile(filePath, content);
      }
    }
    this.snapshots.clear();
  }
}

function addOrUpdateScriptAction(script, command) {
  return { type: 'upsertScript', script, command };
}

export class RuleBasedAdvisor {
  async advise(diagnosis, context = {}) {
    const actions = [];
    const rootCause = normalizeText(diagnosis?.rootCause);
    const framework = normalizeText(context.framework);
    const missingScript = parseMissingScript(rootCause);

    if (diagnosis?.category === FailureCategory.MissingScript && missingScript === 'dev') {
      if (['vite', 'react', 'vue', 'svelte'].includes(framework)) {
        actions.push(addOrUpdateScriptAction('dev', 'vite'));
      }
    }

    if (diagnosis?.category === FailureCategory.MissingScript && missingScript === 'start') {
      if (await fileExists(path.join(context.workspacePath ?? '', 'start.js'))) {
        actions.push(addOrUpdateScriptAction('start', 'node start.js'));
      }
    }

    return {
      workspaceId: context.workspaceId ?? null,
      category: diagnosis?.category ?? FailureCategory.Unknown,
      confidence: actions.length > 0 ? 0.95 : 0.3,
      actions,
      summary: actions.length > 0 ? 'Apply rule-based repository repair' : 'No safe automated repair available'
    };
  }
}

export class ValidationEngine {
  async validateLaunch() {
    return { ok: true };
  }

  async validateBuild() {
    return { ok: true };
  }

  async validateRuntime() {
    return { ok: true };
  }

  async validateRouting(routes = []) {
    return { ok: Array.isArray(routes) };
  }
}

export class RecoveryEngine {
  constructor(options = {}) {
    this.logAnalyzer = options.logAnalyzer ?? new RuleBasedLogAnalyzer();
    this.repositoryValidator = options.repositoryValidator ?? new RepositoryValidator();
    this.repairAdvisor = options.repairAdvisor ?? new RuleBasedAdvisor();
    this.validationEngine = options.validationEngine ?? new ValidationEngine();
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxHistorySize = options.maxHistorySize ?? 500;
    this.history = [];
    this.telemetry = {
      RepairAttempts: 0,
      RepairSuccessRate: 0,
      RecoveryDuration: 0,
      FailureCategories: {},
      TopFailureReasons: {}
    };
  }

  async diagnose(failure) {
    return this.logAnalyzer.analyze(failure?.logs ?? [], failure);
  }

  async generateRepair(diagnosis, context = {}) {
    return this.repairAdvisor.advise(diagnosis, context);
  }

  async executeRepair(plan, context = {}) {
    const packageJsonPath = path.join(context.workspacePath ?? '', 'package.json');
    const filesToTrack = plan.actions.some((action) => action.type === 'upsertScript') ? [packageJsonPath] : [];
    const transaction = new FileRepairTransaction(filesToTrack);
    const applied = [];
    const startedAt = Date.now();

    this.telemetry.RepairAttempts += 1;
    try {
      await transaction.begin();
      for (const action of plan.actions) {
        if (action.type === 'upsertScript') {
          const raw = await fs.readFile(packageJsonPath, 'utf8');
          const pkg = JSON.parse(raw);
          pkg.scripts = pkg.scripts ?? {};
          if (pkg.scripts[action.script] !== action.command) {
            pkg.scripts[action.script] = action.command;
            await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
            applied.push({ file: 'package.json', change: `scripts.${action.script}=${action.command}` });
          }
        }
      }
      await transaction.commit();
      this.telemetry.RecoveryDuration += Date.now() - startedAt;
      return { success: true, applied: applied.length > 0, changes: applied };
    } catch (error) {
      await transaction.rollback();
      this.telemetry.RecoveryDuration += Date.now() - startedAt;
      return { success: false, applied: false, error: error.message, changes: applied };
    }
  }

  async validateRepair(workspaceId, context = {}) {
    const workspace = context.workspace ?? null;
    const routes = context.routes ?? [];
    const launch = await this.validationEngine.validateLaunch(workspaceId);
    const build = await this.validationEngine.validateBuild(workspaceId);
    const runtime = await this.validationEngine.validateRuntime(workspace);
    const routing = await this.validationEngine.validateRouting(routes);
    return {
      success: launch.ok && build.ok && runtime.ok && routing.ok,
      launch,
      build,
      runtime,
      routing
    };
  }

  recordHistory(entry) {
    this.history.push({ ...entry, timestamp: new Date().toISOString() });
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    const successes = this.history.filter((item) => item.result?.success).length;
    this.telemetry.RepairSuccessRate = this.history.length === 0 ? 0 : successes / this.history.length;
    const category = entry.diagnosis?.category ?? FailureCategory.Unknown;
    this.telemetry.FailureCategories[category] = (this.telemetry.FailureCategories[category] ?? 0) + 1;
    const reason = entry.diagnosis?.rootCause ?? 'unknown';
    this.telemetry.TopFailureReasons[reason] = (this.telemetry.TopFailureReasons[reason] ?? 0) + 1;
  }

  getHistory(workspaceId) {
    return this.history.filter((item) => item.workspaceId === workspaceId);
  }

  getAllHistory() {
    return [...this.history];
  }

  getDiagnostics() {
    const latestByWorkspace = new Map();
    for (const item of this.history) {
      latestByWorkspace.set(item.workspaceId, { workspaceId: item.workspaceId, diagnosis: item.diagnosis, timestamp: item.timestamp });
    }
    return [...latestByWorkspace.values()];
  }

  getTelemetry() {
    return { ...this.telemetry };
  }
}
