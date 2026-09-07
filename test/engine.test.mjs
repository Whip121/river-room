import {test} from 'node:test';
import {runChecks} from './checks.mjs';
test('完整扑克规则回归',async()=>{await runChecks();});
