import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const root = new URL("../../", import.meta.url);
const maintenance = new URL("../../scripts/ops/g4-retention-maintenance.mjs", import.meta.url);
const soak = new URL("../../scripts/load/staging-guest-read-soak.mjs", import.meta.url);
const token = "a".repeat(43);

async function run(script,args,env) {
  const child = spawn(process.execPath,[script.pathname,...args],{
    cwd:root.pathname,env:{ ...process.env,...env },
    stdio:["ignore","pipe","pipe"],
  });
  let stdout="",stderr="";
  child.stdout.on("data",data=>stdout+=data);
  child.stderr.on("data",data=>stderr+=data);
  const [code] = await once(child,"close");
  return {code,stdout,stderr};
}

test("DBA maintenance requires explicit command and prune approval",async()=>{
  const help = await run(maintenance,["--help"],{
    PGHOST:"",PGDATABASE:"",PGUSER:"",
  });
  assert.equal(help.code,0);
  assert.match(help.stdout,/read-only|read only|report/i);
  const noApply = await run(maintenance,["prune-guest-budgets"],{
    PGHOST:"localhost",PGDATABASE:"not_connected",PGUSER:"operator",
  });
  assert.notEqual(noApply.code,0);
  assert.match(noApply.stderr,/--apply/);
  const production = await run(maintenance,["prune-guest-budgets","--apply"],{
    NODE_ENV:"production",PGHOST:"localhost",PGDATABASE:"not_connected",PGUSER:"operator",
  });
  assert.notEqual(production.code,0);
  assert.match(production.stderr,/approval/);
});

test("Guest staging read soak collects bounded HTTP timings without leaking bearer",async()=>{
  let requests=0;
  const server=createServer(async(req,res)=>{
    assert.equal(req.url,"/api/guest/ordering-visit/page");
    assert.equal(req.method,"POST");
    let body="";
    for await(const chunk of req)body+=chunk;
    const parsed=JSON.parse(body);
    assert.equal(parsed.token,token);
    assert.equal(parsed.limit,24);
    requests+=1;
    res.writeHead(201,{"Content-Type":"application/json","Cache-Control":"no-store"});
    res.end(JSON.stringify({
      products:[{id:"test",name:"เมนู",priceSatang:2500}],hasMore:false,
    }));
  });
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address=server.address();
  try {
    const base="http://127.0.0.1:"+address.port+"/";
    const r=await run(soak,[],{
      CI:"true",RCAT_STAGING_API_URL:base,
      RCAT_STAGING_CUSTOMER_ORIGIN:base.slice(0,-1),
      RCAT_STAGING_VISIT_TOKEN:token,
      RCAT_SOAK_REQUESTS:"12",RCAT_SOAK_CONCURRENCY:"3",
    });
    assert.equal(r.code,0,r.stderr);
    const report=JSON.parse(r.stdout.trim());
    assert.equal(report.requests,12);
    assert.equal(report.status["201"],12);
    assert.equal(report.invalidResponseSchemas,0);
    assert.equal(requests,12);
    assert.ok(report.p95ms>=0);
    assert.ok(!r.stdout.includes(token));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test("Read soak rejects production targets and unbounded load without requests",async()=>{
  const invalid=await run(soak,[],{
    CI:"false",
    RCAT_STAGING_API_URL:"https://pos.rcat.ac.th/",
    RCAT_STAGING_VISIT_TOKEN:token,
    RCAT_SOAK_REQUESTS:"60",
  });
  assert.notEqual(invalid.code,0);
  assert.ok(!invalid.stderr.includes(token));
  const over=await run(soak,[],{
    CI:"true",RCAT_STAGING_API_URL:"http://127.0.0.1:65533/",
    RCAT_STAGING_VISIT_TOKEN:token,
    RCAT_SOAK_REQUESTS:"900",
  });
  assert.notEqual(over.code,0);
  assert.ok(!over.stderr.includes(token));
});
