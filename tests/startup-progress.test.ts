import test from "node:test";
import assert from "node:assert/strict";
import { startupProgress } from "../src/startup-progress";

test("startup cannot finish while verification, authorization or data are pending", () => {
  const ready = {sessionResolved:true, authorized:true, verifiedVersion:true, dataReady:true};
  assert.equal(startupProgress(ready), 100);
  for(const field of Object.keys(ready)) assert.ok(startupProgress({...ready,[field]:false}) < 100, field);
  assert.equal(startupProgress({...ready,dataReady:false,received:9,expected:9}), 90);
});
test("progress reflects completed snapshots and clamps malformed counts", () => {
  const base = {sessionResolved:true,authorized:true,verifiedVersion:true,dataReady:false,expected:10};
  assert.equal(startupProgress({...base, received:4}),75);
  assert.equal(startupProgress({...base, received:100}),90);
  assert.equal(startupProgress({...base, received:-1}),65);
});
