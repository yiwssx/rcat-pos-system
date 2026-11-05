import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.CI !== "true" || process.env.PGDATABASE !== "rcat_ci_test") {
  throw new Error("Inventory HTTP regression is CI-fixture-only");
}
const port = 31929;
const origin = "http://127.0.0.1:" + port;
const tenant = "00000000-0000-4000-8000-000000000001";
const store = "20000000-0000-4000-8000-000000000001";
const base = `/api/tenants/${tenant}/stores/${store}`;
const inventory = base + "/inventory";
let logs = "";
const server = spawn(process.execPath,["dist/apps/api/src/main.js"],{
  cwd:process.cwd(),
  env:{
    ...process.env,
    NODE_ENV:"test", PORT:String(port),
    ENABLE_DEVELOPMENT_AUTH:"true", AUTH_ALLOWED_ORIGINS:origin,
    AUTH_DATABASE_URL:"postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test",
    TENANT_DATABASE_URL:"postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test",
  },
  stdio:["ignore","pipe","pipe"],
});
server.stdout.on("data",(chunk)=>{logs+=String(chunk);});
server.stderr.on("data",(chunk)=>{logs+=String(chunk);});
function request(path, init={}) {
  return fetch(origin+path,{redirect:"manual",...init});
}
const json = {"Content-Type":"application/json","Origin":origin};
async function signIn(email) {
  const response = await request("/api/auth/login",{
    method:"POST",headers:json,
    body:JSON.stringify({email,password:"example-password-2026"}),
  });
  assert.equal(response.status,200,await response.clone().text());
  const cookies = response.headers.getSetCookie().map((x)=>x.split(";")[0]);
  const csrf = cookies.find((x)=>x.startsWith("__Host-rcat_csrf="))?.split("=")[1];
  assert.ok(csrf);
  return {
    Cookie:cookies.join("; "),
    "X-CSRF-Token":csrf,
  };
}
async function write(path,method,headers,data) {
  return request(path,{method,headers:{...json,...headers},body:JSON.stringify(data)});
}
try {
  let ready=false;
  for(let i=0;i<80;i++){
    if(server.exitCode!==null)throw new Error("Inventory API boot failed: "+logs);
    try { if((await request("/api/health")).status===200){ready=true;break;} }
    catch { /* starting */ }
    await sleep(250);
  }
  assert.ok(ready,"Inventory HTTP integration API did not start");
  const owner=await signIn("a@test.invalid");
  const outsider=await signIn("b@test.invalid");

  assert.equal((await request(inventory)).status,401,
    "Unauthenticated inventory read was allowed");
  assert.equal((await request(inventory,{headers:{Cookie:outsider.Cookie}})).status,404,
    "Other tenant read inventory");
  assert.equal((await write(inventory+"/items","POST",
    {"Cookie":owner.Cookie},{name:"ไม่มี CSRF",unit:"g",reorderAt:"0"})).status,403,
    "Mutation without CSRF succeeded");

  const itemResponse=await write(inventory+"/items","POST",owner,{
    name:"รายการสต็อกทดสอบ",unit:"g",reorderAt:"300.000",
  });
  assert.equal(itemResponse.status,201,await itemResponse.clone().text());
  const {itemId}=await itemResponse.json();
  assert.ok(itemId);

  const key=randomUUID();
  const payload={itemId,idempotencyKey:key,kind:"receipt",
    delta:"1200.125",reason:"HTTP CI fixture delivery"};
  const first=await write(inventory+"/movements","POST",owner,payload);
  assert.equal(first.status,201,await first.clone().text());
  const receipt=await first.json();
  assert.equal(receipt.onHand,"1200.125");
  assert.equal(receipt.replayed,false);
  const again=await write(inventory+"/movements","POST",owner,payload);
  assert.equal(again.status,201,await again.clone().text());
  const replay=await again.json();
  assert.equal(replay.movementId,receipt.movementId);
  assert.equal(replay.replayed,true);
  assert.equal(replay.onHand,receipt.onHand);
  assert.equal((await write(inventory+"/movements","POST",owner,
    {...payload,delta:"100.000"})).status,409,
    "Conflicting replay overwrote stock");

  const adjust=await write(inventory+"/movements","POST",owner,{
    itemId,idempotencyKey:randomUUID(),kind:"adjustment",
    delta:"-200.125",reason:"สินค้าชำรุดจากการขนส่ง",
  });
  assert.equal(adjust.status,201,await adjust.clone().text());
  assert.equal((await adjust.json()).onHand,"1000.000");
  assert.equal((await write(inventory+"/movements","POST",owner,{
    itemId,idempotencyKey:randomUUID(),kind:"adjustment",
    delta:"-1000.001",reason:"ต้องปฏิเสธยอดติดลบ",
  })).status,400,"Negative stock adjustment was accepted");
  assert.equal((await write(inventory+"/movements","POST",outsider,{
    itemId,idempotencyKey:randomUUID(),kind:"receipt",
    delta:"10",reason:"wrong tenant write",
  })).status,404,"Foreign tenant changed stock");

  const categoryResponse=await write(base+"/catalog/categories","POST",owner,{
    slug:"stock-ci-menu",name:"เมนูทดสอบสต็อก",
  });
  assert.equal(categoryResponse.status,201,await categoryResponse.clone().text());
  const {categoryId}=await categoryResponse.json();
  const productResponse=await write(base+"/catalog/products","POST",owner,{
    categoryId,name:"เมนูทดสอบการผูกสูตร",priceSatang:4900,
  });
  assert.equal(productResponse.status,201,await productResponse.clone().text());
  const {productId}=await productResponse.json();
  const trackedPath=inventory+"/products/"+productId+"/tracking";
  assert.equal((await write(trackedPath,"PUT",owner,{tracked:true})).status,409,
    "Tracking product without a base recipe must fail closed");
  assert.equal((await write(trackedPath,"PUT",outsider,{tracked:true})).status,404,
    "Another tenant cannot enable product tracking");
  assert.equal((await write(trackedPath,"PUT",
    {Cookie:owner.Cookie},{tracked:true})).status,403,
    "Tracking toggle without CSRF was accepted");
  const recipePath=inventory+"/recipes/"+productId+"/items/"+itemId;
  const setRecipe=await write(recipePath,"PUT",owner,{quantityPerProduct:"150.250"});
  assert.equal(setRecipe.status,200,await setRecipe.clone().text());
  const snapshot=await request(inventory,{headers:{Cookie:owner.Cookie}});
  assert.equal(snapshot.status,200,await snapshot.clone().text());
  assert.equal(snapshot.headers.get("cache-control"),"no-store");
  const data=await snapshot.json();
  assert.equal(data.stockMode,"manual_ledger_only");
  assert.equal(data.orderConsumptionEnabled,false);
  assert.equal(data.items.find((x)=>x.itemId===itemId).onHand,"1000.000");
  assert.equal(data.recipes.find((x)=>x.productId===productId).quantityPerProduct,"150.250");
  assert.equal(data.recentMovements.filter((x)=>x.itemId===itemId).length,2);
  const group=await write(base+"/catalog/products/"+productId+"/modifier-groups",
    "POST",owner,{slug:"extra-stock",name:"Extra stock",minSelect:0,maxSelect:1});
  assert.equal(group.status,201,await group.clone().text());
  const {groupId}=await group.json();
  const option=await write(base+"/catalog/products/"+productId+
    "/modifier-groups/"+groupId+"/options",
    "POST",owner,{name:"Extra rice",priceDeltaSatang:100});
  assert.equal(option.status,201,await option.clone().text());
  const {optionId}=await option.json();
  const optionRecipe=inventory+"/modifier-recipes/"+productId+
    "/groups/"+groupId+"/options/"+optionId+"/items/"+itemId;
  const modifierResult=await write(optionRecipe,"PUT",owner,
    {quantityPerProduct:"25.125"});
  assert.equal(modifierResult.status,200,await modifierResult.clone().text());
  assert.equal((await write(optionRecipe,"PUT",outsider,
    {quantityPerProduct:"25.125"})).status,404);
  const enabled=await write(trackedPath,"PUT",owner,{tracked:true});
  assert.equal(enabled.status,200,await enabled.clone().text());
  const enabledSnapshot=await request(inventory,{headers:{Cookie:owner.Cookie}});
  const enabledData=await enabledSnapshot.json();
  assert.equal(enabledData.stockMode,"order_acceptance_opt_in");
  assert.equal(enabledData.orderConsumptionEnabled,true);
  assert.ok(enabledData.trackedProducts.some((x)=>x.productId===productId));
  assert.equal(enabledData.modifierRecipes.find((x)=>x.optionId===optionId)
    .quantityPerProduct,"25.125");
  const disabled=await write(trackedPath,"PUT",owner,{tracked:false});
  assert.equal(disabled.status,200,await disabled.clone().text());
  const disabledData=await (await request(inventory,{
    headers:{Cookie:owner.Cookie},
  })).json();
  assert.equal(disabledData.stockMode,"manual_ledger_only");
  assert.equal(disabledData.orderConsumptionEnabled,false);


  assert.equal((await write(recipePath,"PUT",owner,
    {quantityPerProduct:"0"})).status,200);
  const after=(await (await request(inventory,{headers:{Cookie:owner.Cookie}})).json());
  assert.equal(after.recipes.some((x)=>x.productId===productId),false);
  assert.equal(after.items.find((x)=>x.itemId===itemId).onHand,"1000.000");
  const stocktakes=inventory+"/stocktakes";
  assert.equal((await request(stocktakes)).status,401,
    "Anonymous staff read Stocktake history");
  assert.equal((await request(stocktakes,{
    headers:{Cookie:outsider.Cookie},
  })).status,404,"Other tenant read Stocktake history");
  const takeRequest={itemId,idempotencyKey:randomUUID()};
  assert.equal((await write(stocktakes,"POST",
    {Cookie:owner.Cookie},takeRequest)).status,403,
    "Stocktake opening without CSRF was accepted");
  const opened=await write(stocktakes,"POST",owner,takeRequest);
  assert.equal(opened.status,201,await opened.clone().text());
  const stocktake=await opened.json();
  assert.equal(stocktake.state,"open");
  assert.equal(stocktake.baselineOnHand,"1000.000");
  const reopened=await write(stocktakes,"POST",owner,takeRequest);
  assert.equal(reopened.status,201,await reopened.clone().text());
  assert.equal((await reopened.json()).replayed,true);
  const listing=await request(stocktakes,{headers:{Cookie:owner.Cookie}});
  assert.equal(listing.status,200,await listing.clone().text());
  assert.equal(listing.headers.get("cache-control"),"no-store");
  const {stocktakes:history}=await listing.json();
  assert.ok(history.some((entry)=>entry.stocktakeId===stocktake.stocktakeId));
  assert.equal((await write(stocktakes+"/"+stocktake.stocktakeId+
    "/count","POST",outsider,{countedOnHand:"999.000",
      reason:"Unauthorized count"})).status,404);
  const count=await write(stocktakes+"/"+stocktake.stocktakeId+
    "/count","POST",owner,{countedOnHand:"999.000",
      reason:"Physical count verified"});
  assert.equal(count.status,201,await count.clone().text());
  assert.equal((await count.json()).state,"submitted");
  assert.equal((await write(stocktakes+"/"+stocktake.stocktakeId+
    "/review","POST",owner,{approve:true})).status,409,
    "Same staff member was allowed to approve their own count");
  assert.equal((await write(stocktakes+"/"+stocktake.stocktakeId+
    "/review","POST",outsider,{approve:true})).status,404,
    "Other tenant approved Stocktake");
  const still=(await (await request(inventory,{
    headers:{Cookie:owner.Cookie},
  })).json());
  assert.equal(still.items.find((i)=>i.itemId===itemId).onHand,
    "1000.000","Unapproved physical count changed live stock");
  console.log("PASS: inventory HTTP tenant auth, CSRF, exact ledger, opt-in stock, Modifier recipe and safe disable, Stocktake RBAC, CSRF and no self-approval");
} finally {
  server.kill("SIGTERM");
}
