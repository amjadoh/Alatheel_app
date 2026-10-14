import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  emptyState,
  visibleState,
  Actor,
} from "../functions/src/domain";
import { assertOwnerLink, invitationRequested } from "../functions/src/owners";
const admin: Actor = { uid: "admin", role: "admin", displayName: "المدير" };
const op = (
  action: string,
  requestId: string,
  data: Record<string, any>,
  id?: string,
) => ({ action, requestId, data, id });

test("manager registers owner, horse and collection without any login, email or owner approval", () => {
  let s = applyCommand(
    emptyState(),
    admin,
    op("owner.save", "owner_001", {
      displayName: "مالك تجريبي",
      linkedUserId: "attacker",
      role: "admin",
    }),
  );
  assert.equal(s.users.length, 0);
  assert.equal(s.owners[0].email, "");
  assert.equal(s.owners[0].linkedUserId, undefined);
  assert.equal(s.owners[0].role, undefined);
  s = applyCommand(
    s,
    admin,
    op("horse.save", "horse_001", {
      name: "خيل تجربة",
      ownerId: "owner_001",
      status: "boarding",
      entryDate: "2026-01-01",
      dueDate: "2026-02-01",
      boardingFee: 2000,
    }),
  );
  assert.equal(s.registrationRequests.length, 0);
  s = applyCommand(
    s,
    admin,
    op(
      "income.collect",
      "collect_001",
      { expectedDueDate: "2026-02-01", expectedAmount: 2000 },
      "horse_001",
    ),
  );
  assert.equal(s.income[0].ownerId, "owner_001");
  assert.equal(s.income[0].amount, 2000);
  assert.equal(s.horses[0].dueDate, "2026-03-01");
  const linked: Actor = {
    uid: "google_user",
    role: "owner",
    displayName: "مالك",
    ownerRecordId: "owner_001",
  };
  assert.equal(visibleState(s, linked).horses.length, 1);
  assert.equal(visibleState(s, linked).income.length, 1);
  assert.equal(
    visibleState(s, { ...linked, ownerRecordId: "another_owner" }).horses
      .length,
    0,
  );
  assert.equal(visibleState(s, linked).owners.length, 0);
  const receiptName = s.income[0].ownerName;
  s.owners[0].linkedUserId = linked.uid;
  s = applyCommand(
    s,
    admin,
    op(
      "owner.save",
      "edit_001",
      { displayName: "الاسم الصحيح", linkedUserId: "hijack", email: "" },
      "owner_001",
    ),
  );
  assert.equal(s.horses[0].ownerName, "الاسم الصحيح");
  assert.equal(s.income[0].ownerName, receiptName);
  assert.equal(s.owners[0].linkedUserId, linked.uid);
});

test("owners cannot create owner records or register horses through staff commands", () => {
  const owner: Actor = { uid: "owner", role: "owner", displayName: "مالك" };
  assert.throws(
    () =>
      applyCommand(
        emptyState(),
        owner,
        op("owner.save", "owner_002", { displayName: "test" }),
      ),
    /للإدارة/,
  );
  assert.throws(
    () =>
      applyCommand(
        emptyState(),
        admin,
        op("horse.save", "horse_002", { ownerId: "missing" }),
      ),
    /السجل غير موجود/,
  );
});

test("optional invitations require explicit selection; owner record does not grant Google access", () => {
  assert.equal(invitationRequested({}), false);
  assert.equal(invitationRequested({ sendInvitation: "no" }), false);
  assert.equal(invitationRequested({ sendInvitation: "yes" }), true);
  assert.equal(invitationRequested({ sendInvitation: true }), true);
});

test("account links cannot steal another owner's records or silently change ownership", () => {
  const record = { id: "owner_record", email: "Owner@example.com" };
  assert.doesNotThrow(() =>
    assertOwnerLink(record, "uid", "owner@example.com"),
  );
  assert.throws(
    () => assertOwnerLink(undefined, "uid", "owner@example.com"),
    /غير موجود/,
  );
  assert.throws(
    () =>
      assertOwnerLink(
        { ...record, linkedUserId: "another_uid" },
        "uid",
        "owner@example.com",
      ),
    /بحساب آخر/,
  );
  assert.throws(
    () => assertOwnerLink(record, "uid", "other@example.com"),
    /لا يطابق/,
  );
  assert.throws(
    () => assertOwnerLink(record, "uid", "owner@example.com", "other_record"),
    /بمالك آخر/,
  );
});

test("linked owner requests use the same business owner id", () => {
  const owner: Actor = {
    uid: "google_uid",
    role: "owner",
    displayName: "مالك",
    ownerRecordId: "existing_owner",
  };
  let s = applyCommand(
    emptyState(),
    owner,
    op("request.create", "request_001", {
      horseName: "جديد",
      age: "4",
      requestType: "boarding",
    }),
  );
  assert.equal(s.registrationRequests[0].ownerId, "existing_owner");
  s = applyCommand(
    s,
    admin,
    op(
      "request.review",
      "review_001",
      { status: "awaiting_owner_approval", boardingFee: 2500 },
      "request_001",
    ),
  );
  s = applyCommand(
    s,
    owner,
    op("request.accept", "accept_001", {}, "request_001"),
  );
  assert.equal(s.horses[0].ownerId, "existing_owner");
});
