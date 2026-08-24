class CompactReporter {
  constructor() {
    this.counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 };
    this.failures = [];
  }

  onTestEnd(test, result) {
    const key = result.status === 'timedOut' ? 'timedOut' : result.status;
    this.counts[key] = (this.counts[key] || 0) + 1;
    if (!['passed', 'skipped'].includes(result.status)) {
      this.failures.push(test.titlePath().slice(1).join(' > '));
    }
  }

  onEnd() {
    process.stdout.write(`${JSON.stringify({ counts: this.counts, failures: this.failures }, null, 2)}\n`);
  }
}

module.exports = CompactReporter;
