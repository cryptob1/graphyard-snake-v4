import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorRoot, declaredWorkers, installIdOf, maxWorkers, parseArguments, planCapacity, workerPrincipal } from '../scripts/graphyard-executor.mjs';

const install = 'cryptob1-graphyard-snake-v4';
const worker1 = workerPrincipal(install, 1), worker2 = workerPrincipal(install, 2);

test('unit:capacity-declaration the repository declares its worker count in graphyard.json capacity.workers, defaulting to one', () => {
  assert.equal(declaredWorkers(JSON.stringify({ capacity: { workers: 2 } })), 2);
  assert.equal(declaredWorkers('{}'), 1, 'a repository without a capacity block declares one worker');
  assert.equal(declaredWorkers(JSON.stringify({ capacity: {} })), 1);
  for (const bad of [0, -1, 1.5, 'two', true]) {
    assert.throws(() => declaredWorkers(JSON.stringify({ capacity: { workers: bad } })), /capacity\.workers must be a whole number/);
  }
  assert.throws(() => declaredWorkers('not json'), /not valid JSON/);
});

test('unit:capacity-declaration the command line takes exactly one of --status or --install and a whole --count', () => {
  assert.deepEqual(parseArguments(['--status']), { status: true, install: false, count: null });
  assert.deepEqual(parseArguments(['--install', '--count', '3']), { status: false, install: true, count: 3 });
  assert.throws(() => parseArguments([]), /exactly one/);
  assert.throws(() => parseArguments(['--status', '--install']), /exactly one/);
  assert.throws(() => parseArguments(['--install', '--count', '0']), /whole number/);
  assert.throws(() => parseArguments(['--install', '--count', 'two']), /whole number/);
  assert.throws(() => parseArguments(['--install', '--count', `${maxWorkers + 1}`]), /whole number/);
  assert.throws(() => parseArguments(['--wipe']), /Unknown argument/);
});

test('unit:capacity-plan a declaration above the live profiles asks for the conventional next principal, its credential and a profile regeneration', () => {
  const plan = planCapacity({ declared: 2, installId: install, profiles: [{ principal: worker1 }], rosterPrincipals: [worker1], workerFolderTokens: [worker1] });
  assert.equal(plan.live, 1);
  assert.deepEqual(plan.addPrincipals, [worker2]);
  assert.deepEqual(plan.copyTokens, [worker2]);
  assert.equal(plan.applyEnvironments, true);
  assert.equal(plan.ready, false);
});

test('unit:capacity-plan a declaration the live profiles already meet plans nothing: the reconciler is a no-op', () => {
  for (const profiles of [[{ principal: worker1 }, { principal: worker2 }], [{ principal: worker1 }, { principal: 'some-other-worker' }]]) {
    const plan = planCapacity({ declared: 2, installId: install, profiles, rosterPrincipals: [worker1], workerFolderTokens: [worker1] });
    assert.equal(plan.ready, true);
    assert.deepEqual(plan.addPrincipals, []);
    assert.deepEqual(plan.copyTokens, []);
    assert.equal(plan.applyEnvironments, false);
  }
});

test('unit:capacity-plan a principal already on the roster is not re-added, only its credential copy and profile are planned', () => {
  const plan = planCapacity({ declared: 2, installId: install, profiles: [{ principal: worker1 }], rosterPrincipals: [worker1, worker2], workerFolderTokens: [worker1] });
  assert.deepEqual(plan.addPrincipals, []);
  assert.deepEqual(plan.copyTokens, [worker2]);
  assert.equal(plan.applyEnvironments, true);
});

test('unit:capacity-plan a credential already where master environments reads it is not copied again', () => {
  const plan = planCapacity({ declared: 2, installId: install, profiles: [{ principal: worker1 }], rosterPrincipals: [worker1, worker2], workerFolderTokens: [worker1, worker2] });
  assert.deepEqual(plan.addPrincipals, []);
  assert.deepEqual(plan.copyTokens, []);
  assert.equal(plan.applyEnvironments, true, 'the launch profile is still missing, so environments must run');
});

test('unit:capacity-plan an empty installation is brought up from one: nothing is special-cased about the first profile', () => {
  const plan = planCapacity({ declared: 1, installId: install, profiles: [], rosterPrincipals: [], workerFolderTokens: [] });
  assert.deepEqual(plan.addPrincipals, [worker1]);
  assert.deepEqual(plan.copyTokens, [worker1]);
  assert.equal(plan.ready, false);
});

test('unit:capacity-plan the declaration is a count, so it never plans past it and never plans a removal', () => {
  const plan = planCapacity({ declared: 1, installId: install, profiles: [{ principal: worker1 }, { principal: worker2 }], rosterPrincipals: [worker1, worker2], workerFolderTokens: [worker1] });
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.addPrincipals, []);
  assert.deepEqual(plan.copyTokens, [], 'an extra live profile is reported, never removed');
});

test('unit:capacity-plan the install id follows the repository the way graphyard install derives it', () => {
  assert.equal(installIdOf('cryptob1/graphyard-snake-v4'), install);
  assert.equal(workerPrincipal(install, 2), `${install}-worker-2`);
  assert.throws(() => installIdOf('not-a-repository'), /OWNER\/NAME/);
});

test('unit:capacity-root the reconciler runs only from the coordinator checkout, never from a managed worktree', () => {
  const tree = {};
  const exists = path => !!tree[path];
  const scriptDirectory = '/tmp/coordinator-checkout/scripts';
  tree['/tmp/coordinator-checkout/.graphyard/master.json'] = true;
  assert.equal(coordinatorRoot(scriptDirectory, exists), '/tmp/coordinator-checkout');
  assert.throws(() => coordinatorRoot('/tmp/worktrees/GY-14-1/scripts', exists), /is not the coordinator checkout.*master\.json/s);
});
