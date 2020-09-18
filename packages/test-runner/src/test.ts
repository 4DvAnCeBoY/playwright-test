/**
 * Copyright Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type Configuration = { name: string, value: string }[];

export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped';

export class Runnable {
  title: string;
  file: string;
  location: string;
  parent?: Suite;

  _only = false;
  _skipped = false;
  _flaky = false;
  _slow = false;
  _expectedStatus?: TestStatus = 'passed';
  // Annotations are those created by test.fail('Annotation')
  _annotations: any[] = [];

  _id: string;
  _ordinal: number;

  isOnly(): boolean {
    return this._only;
  }

  isSlow(): boolean {
    return this._slow;
  }

  slow(): void;
  slow(condition: boolean): void;
  slow(description: string): void;
  slow(condition: boolean, description: string): void;
  slow(arg?: boolean | string, description?: string) {
    const processed = this._interpretCondition(arg, description);
    if (processed.condition) {
      this._slow = true;
      this._annotations.push({
        type: 'slow',
        description: processed.description
      });
    }
  }

  skip(): void;
  skip(condition: boolean): void;
  skip(description: string): void;
  skip(condition: boolean, description: string): void;
  skip(arg?: boolean | string, description?: string) {
    const processed = this._interpretCondition(arg, description);
    if (processed.condition) {
      this._skipped = true;
      this._annotations.push({
        type: 'skip',
        description: processed.description
      });
    }
  }

  fixme(): void;
  fixme(condition: boolean): void;
  fixme(description: string): void;
  fixme(condition: boolean, description: string): void;
  fixme(arg?: boolean | string, description?: string) {
    const processed = this._interpretCondition(arg, description);
    if (processed.condition) {
      this._skipped = true;
      this._annotations.push({
        type: 'fixme',
        description: processed.description
      });
    }
  }

  flaky(): void;
  flaky(condition: boolean): void;
  flaky(description: string): void;
  flaky(condition: boolean, description: string): void;
  flaky(arg?: boolean | string, description?: string) {
    const processed = this._interpretCondition(arg, description);
    if (processed.condition) {
      this._flaky = true;
      this._annotations.push({
        type: 'flaky',
        description: processed.description
      });
    }
  }

  fail(): void;
  fail(condition: boolean): void;
  fail(description: string): void;
  fail(condition: boolean, description: string): void;
  fail(arg?: boolean | string, description?: string) {
    const processed = this._interpretCondition(arg, description);
    if (processed.condition) {
      this._expectedStatus = 'failed';
      this._annotations.push({
        type: 'fail',
        description: processed.description
      });
    }
  }

  private _interpretCondition(arg?: boolean | string, description?: string): { condition: boolean, description?: string } {
    if (arg === undefined && description === undefined)
      return { condition: true };
    if (typeof arg === 'string')
      return { condition: true, description: arg };
    return { condition: !!arg, description };
  }

  isSkipped(): boolean {
    return this._skipped || (this.parent && this.parent.isSkipped());
  }

  _isSlow(): boolean {
    return this._slow || (this.parent && this.parent._isSlow());
  }

  expectedStatus(): TestStatus {
    return this._expectedStatus || (this.parent && this.parent.expectedStatus()) || 'passed';
  }

  isFlaky(): boolean {
    return this._flaky || (this.parent && this.parent.isFlaky());
  }

  titlePath(): string[] {
    if (!this.parent)
      return [];
    if (!this.title)
      return this.parent.titlePath();
    return [...this.parent.titlePath(), this.title];
  }

  fullTitle(): string {
    return this.titlePath().join(' ');
  }

  annotations(): any[] {
    if (!this.parent)
      return this._annotations;
    return [...this._annotations, ...this.parent.annotations()];
  }

  _copyFrom(other: Runnable) {
    this.file = other.file;
    this.location = other.location;
    this._only = other._only;
    this._flaky = other._flaky;
    this._skipped = other._skipped;
    this._slow = other._slow;
    this._ordinal = other._ordinal;
  }
}

export class Test extends Runnable {
  fn: Function;
  results: TestResult[] = [];
  _overriddenFn: Function;
  _startTime: number;
  _endTime: number;
  _timeout = 0;
  _workerId: number;

  constructor(title: string, fn: Function) {
    super();
    this.title = title;
    this.fn = fn;
  }

  _appendResult(): TestResult {
    const result: TestResult = {
      duration: 0,
      stdout: [],
      stderr: [],
      data: {}
    };
    this.results.push(result);
    return result;
  }

  timeout(): number {
    return this._timeout;
  }

  startTime(): number {
    return this._startTime;
  }

  endTime(): number {
    return this._endTime;
  }

  duration(): number {
    return (this._endTime - this._startTime) || 0;
  }

  workerId(): number {
    return this._workerId;
  }

  ok(): boolean {
    if (this.isSkipped())
      return true;
    const hasFailedResults = !!this.results.find(r => r.status !== this.expectedStatus());
    if (!hasFailedResults)
      return true;
    if (!this.isFlaky())
      return false;
    const hasPassedResults = !!this.results.find(r => r.status === this.expectedStatus());
    return hasPassedResults;
  }

  _hasResultWithStatus(status: TestStatus): boolean {
    return !!this.results.find(r => r.status === status);
  }
}

export type TestResult = {
  duration: number;
  status?: TestStatus;
  error?: any;
  stdout: (string | Buffer)[];
  stderr: (string | Buffer)[];
  data: any;
}

export class Suite extends Runnable {
  suites: Suite[] = [];
  tests: Test[] = [];
  // Desired worker configuration.
  configuration: Configuration;
  // Configuration above, serialized in [name1=value1,name2=value2] form.
  _configurationString: string;
  // Worker hash that includes configuration and worker registration locations.
  _workerHash: string;

  _hooks: { type: string, fn: Function } [] = [];
  _entries: (Suite | Test)[] = [];

  constructor(title: string, parent?: Suite) {
    super();
    this.title = title;
    this.parent = parent;
  }

  total(): number {
    let count = 0;
    this.findTest(fn => {
      ++count;
    });
    return count;
  }

  _addTest(test: Test) {
    test.parent = this;
    this.tests.push(test);
    this._entries.push(test);
  }

  _addSuite(suite: Suite) {
    suite.parent = this;
    this.suites.push(suite);
    this._entries.push(suite);
  }

  eachSuite(fn: (suite: Suite) => boolean | void): boolean {
    for (const suite of this.suites) {
      if (suite.eachSuite(fn))
        return true;
    }
    return false;
  }

  findTest(fn: (test: Test) => boolean | void): boolean {
    for (const suite of this.suites) {
      if (suite.findTest(fn))
        return true;
    }
    for (const test of this.tests) {
      if (fn(test))
        return true;
    }
    return false;
  }

  findSuite(fn: (suite: Suite) => boolean | void): boolean {
    if (fn(this))
      return true;
    for (const suite of this.suites) {
      if (suite.findSuite(fn))
        return true;
    }
    return false;
  }

  _allTests(): Test[] {
    const result: Test[] = [];
    this.findTest(test => { result.push(test); });
    return result;
  }

  _renumber() {
    // All tests and suites are identified with their ordinals.
    let ordinal = 0;
    this.findSuite((suite: Suite) => {
      suite._ordinal = ordinal++;
    });

    ordinal = 0;
    this.findTest((test: Test) => {
      test._ordinal = ordinal++;
    });
  }

  _assignIds() {
    this.findSuite((suite: Suite) => {
      suite._id = `${suite._ordinal}@${this.file}::[${this._configurationString}]`;
    });
    this.findTest((test: Test) => {
      test._id = `${test._ordinal}@${this.file}::[${this._configurationString}]`;
    });
  }

  _addHook(type: string, fn: any) {
    this._hooks.push({ type, fn });
  }

  _hasTestsToRun(): boolean {
    let found = false;
    this.findTest(test => {
      if (!test.isSkipped()) {
        found = true;
        return true;
      }
    });
    return found;
  }
}

export function serializeConfiguration(configuration: Configuration): string {
  const tokens = [];
  for (const { name, value } of configuration)
    tokens.push(`${name}=${value}`);
  return tokens.join(', ');
}

export function serializeError(error: Error | any): any {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }
  return trimCycles(error);
}

function trimCycles(obj: any): any {
  const cache = new Set();
  return JSON.parse(
      JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value))
            return '' + value;
          cache.add(value);
        }
        return value;
      })
  );
}
