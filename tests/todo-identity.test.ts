import test from "node:test";
import assert from "node:assert/strict";
import { type Task } from "../lib/model";
import { todoAliases } from "../lib/todo-identity";
const manual: Task = { id:"manual", title:"Practice Log", deadlineId:"practice", projectId:null, milestoneId:null, status:"active", importance:"normal", estimate:30, remaining:30, notes:"", createdAt:"2026-11-22T10:00:00Z", completedAt:null };
test("saved AI copies resolve to original tasks without merging manual records or booked work",()=>{
 const duplicate = {...manual,id:"ai-copy",estimate:null,remaining:null,aiTodoDate:"2026-11-22"};
 const otherManual = {...manual,id:"other-manual"};
 const otherScope = {...duplicate,id:"other-deadline",deadlineId:"other"};
 const differentAspect = {...duplicate,id:"aspect",title:"Practice Log reflection"};
 const booked = {...duplicate,id:"booked"};
 const aliases = todoAliases([duplicate,manual,otherManual,otherScope,differentAspect,booked],new Set(["booked"]));
 assert.equal(aliases.get("ai-copy"),"manual");
 for (const id of ["manual","other-manual","other-deadline","aspect","booked"]) assert(!aliases.has(id));
 assert.equal(manual.estimate,30);
});
