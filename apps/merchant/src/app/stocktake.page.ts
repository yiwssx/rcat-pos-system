import { DOCUMENT } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { InventoryApi } from "./inventory.api";
import {
  InventoryItem,
  StocktakeRecord,
  formatUnits,
  stocktakeDifference,
  validPhysicalCount,
} from "./inventory.domain";
import { MerchantOrderApi } from "./merchant-order.api";
import { MerchantStore } from "./order-board.domain";

function message(error:unknown):string {
  if(error instanceof HttpErrorResponse) {
    if(error.status===401)return "Session หมดอายุ โปรดเข้าสู่ระบบอีกครั้ง";
    if(error.status===403||error.status===404)
      return "ไม่มีสิทธิ์เข้าถึง Stocktake ของร้านนี้";
    if(error.status===409) {
      const details=typeof error.error?.message==="string"?error.error.message:"";
      if(details.includes("Inventory has changed"))
        return "สต็อกมีการเคลื่อนไหวหลังเปิดรอบตรวจนับ ห้ามอนุมัติยอดเก่า กรุณาปฏิเสธแล้วเริ่มตรวจนับใหม่";
      if(details.includes("two independent staff"))
        return "ต้องใช้ผู้ตรวจนับและผู้อนุมัติคนละบัญชี หรือรอบตรวจนับถูกปิดแล้ว";
      return "มีรอบตรวจนับที่ยังไม่ปิด หรือข้อมูลเปลี่ยนไปแล้ว โปรดโหลดล่าสุด";
    }
    if(error.status===400)return "จำนวนหรือเหตุผลไม่ถูกต้อง";
    if(error.status===0)return "เครือข่ายไม่พร้อม โปรดตรวจสอบก่อนลองอีกครั้ง";
  }
  return error instanceof Error?error.message:"ดำเนินการไม่สำเร็จ";
}

@Component({
  standalone:true,
  changeDetection:ChangeDetectionStrategy.OnPush,
  imports:[RouterLink],
  styleUrls:["./stocktake.css"],
  template:`
  <main class="stocktake-shell">
    <a [routerLink]="['/inventory',tenantId,storeId]" class="stocktake-back">
      ← กลับไปสต็อกวัตถุดิบ
    </a>
    <span class="eyebrow">RCAT POS / STOCKTAKE CONTROL</span>
    <h1>ตรวจนับและกระทบยอดสต็อก</h1>
    <p class="stocktake-muted">
      {{ store()?.storeName || "กำลังตรวจสิทธิ์" }}
      · ตรวจนับแยกจากการปรับยอดด้วยมือ และไม่ใช่ข้อมูลรับชำระเงิน
    </p>
    <p class="stocktake-caution" role="note">
      <strong>ต้องใช้บุคลากรสองคน</strong>
      ผู้ส่งยอดตรวจนับไม่สามารถอนุมัติเองได้
      เมื่อสต็อกเปลี่ยนระหว่างตรวจนับ ระบบจะปฏิเสธการอนุมัติ
      ต้องปฏิเสธรอบเก่าแล้วเริ่มรอบใหม่
    </p>
    @if(error()) {
      <div class="stocktake-error" role="alert">{{ error() }}</div>
    }
    @if(notice()) {
      <div class="stocktake-success" role="status">{{ notice() }}</div>
    }
    @if(loading()) {
      <p class="stocktake-muted" role="status">กำลังอ่านข้อมูลล่าสุดจาก Server...</p>
    }
    @if(store();as currentStore) {
      <div class="stocktake-actions">
        <button type="button" [disabled]="busy()||loading()" (click)="reload()">
          โหลดข้อมูลล่าสุด
        </button>
      </div>
      <div class="stocktake-grid">
        @if(currentStore.role==="owner"||currentStore.role==="manager") {
          <section class="stocktake-panel" aria-labelledby="stocktake-open-title">
            <h2 id="stocktake-open-title">1. เปิดรอบตรวจนับ</h2>
            <p class="stocktake-muted">
              ระบบบันทึกยอดตั้งต้นและ Stock Version ก่อนเริ่มนับ
              วัตถุดิบหนึ่งรายการเปิดรอบค้างอยู่ได้เพียงหนึ่งรอบ
            </p>
            <form (submit)="open($event)" class="stocktake-form">
              <label>วัตถุดิบที่ต้องตรวจนับ
                <select [value]="openItemId()" (change)="setSelected($event,'open')" required>
                  <option value="">เลือกวัตถุดิบ</option>
                  @for(item of ingredients();track item.itemId) {
                    <option [value]="item.itemId">
                      {{ item.name }} · {{ formatQuantity(item.onHand) }} {{ item.unit }}
                    </option>
                  }
                </select>
              </label>
              <button type="submit" [disabled]="busy()||!ingredients().length">
                เปิดรอบตรวจนับ
              </button>
            </form>
          </section>
        }

        <section class="stocktake-panel" aria-labelledby="stocktake-count-title">
          <h2 id="stocktake-count-title">2. ส่งยอดที่ตรวจนับจริง</h2>
          <p class="stocktake-muted">
            เจ้าของร้าน ผู้จัดการ หรือพนักงานครัวที่ได้รับสิทธิ์ส่งผลการนับได้
            แต่บุคคลเดียวกันจะอนุมัติผลนั้นไม่ได้
          </p>
          <form (submit)="submitCount($event)" class="stocktake-form">
            <label>รอบที่เปิดอยู่
              <select [value]="countTakeId()" (change)="setSelected($event,'count')" required>
                <option value="">เลือกรอบตรวจนับ</option>
                @for(take of openStocktakes();track take.stocktakeId) {
                  <option [value]="take.stocktakeId">
                    {{ itemLabel(take.itemId) }} · ตั้งต้น
                    {{ formatQuantity(take.baselineOnHand) }}
                  </option>
                }
              </select>
            </label>
            <label>ยอดตรวจนับจริง (g / ml / ชิ้น)
              <input type="text" inputmode="decimal" required
                [value]="countedOnHand()" (input)="setText($event,'count')"
                placeholder="เช่น 1250.500">
            </label>
            <label>เหตุผล/หลักฐานการตรวจนับ
              <input type="text" maxlength="200" required
                [value]="countReason()" (input)="setText($event,'reason')"
                placeholder="เช่น ตรวจนับปิดกะบ่าย">
            </label>
            <button type="submit" [disabled]="busy()||!openStocktakes().length">
              ส่งยอดตรวจนับให้ผู้ตรวจสอบ
            </button>
          </form>
        </section>
      </div>

      <section class="stocktake-panel" aria-labelledby="stocktake-review-title">
        <h2 id="stocktake-review-title">3. ตรวจสอบความคลาดเคลื่อนและตัดสินใจ</h2>
        <p class="stocktake-muted">
          แสดง 40 รอบล่าสุดของร้าน ผู้อนุมัติต้องเป็น Owner/Manager
          และไม่ใช่ผู้ส่งยอดนับ ระบบบันทึก Audit ทุกการตัดสินใจ
        </p>
        @if(stocktakes().length===0) {
          <p class="stocktake-muted">ยังไม่มีรอบตรวจนับ</p>
        } @else {
          <div class="stocktake-records">
            @for(take of stocktakes();track take.stocktakeId) {
              <article class="stocktake-record">
                <div class="stocktake-record-heading">
                  <h3>{{ itemLabel(take.itemId) }}</h3>
                  <span>{{ statusLabel(take.state) }}</span>
                </div>
                <dl>
                  <div><dt>ยอดตั้งต้น</dt>
                    <dd>{{ formatQuantity(take.baselineOnHand) }}</dd></div>
                  <div><dt>ยอดที่นับ</dt>
                    <dd>{{ take.countedOnHand===null?"—":formatQuantity(take.countedOnHand) }}</dd></div>
                  <div><dt>ส่วนต่าง</dt>
                    <dd>{{ difference(take.countedOnHand,take.baselineOnHand) }}</dd></div>
                  <div><dt>เวอร์ชันตั้งต้น</dt>
                    <dd>{{ take.baselineVersion }}</dd></div>
                  <div><dt>ผู้ส่งยอด</dt>
                    <dd>{{ shortId(take.submittedBy) }}</dd></div>
                  <div><dt>ผู้อนุมัติ/ปฏิเสธ</dt>
                    <dd>{{ shortId(take.reviewedBy) }}</dd></div>
                </dl>
                @if(take.reason) { <p class="stocktake-muted">{{ take.reason }}</p> }
                @if(take.state==="submitted"&&
                  (currentStore.role==="owner"||currentStore.role==="manager")) {
                  <div class="stocktake-buttons">
                    <button type="button" [disabled]="busy()"
                      (click)="review(take,true)">อนุมัติปรับยอด</button>
                    <button type="button" class="stocktake-reject" [disabled]="busy()"
                      (click)="review(take,false)">ปฏิเสธรอบตรวจนับ</button>
                  </div>
                }
              </article>
            }
          </div>
        }
      </section>
    }
  </main>
  `,
})
export class StocktakePage implements OnInit {
  private readonly inventory=inject(InventoryApi);
  private readonly merchant=inject(MerchantOrderApi);
  private readonly route=inject(ActivatedRoute);
  private readonly document=inject(DOCUMENT);
  readonly tenantId=this.route.snapshot.paramMap.get("tenantId")??"";
  readonly storeId=this.route.snapshot.paramMap.get("storeId")??"";
  readonly store=signal<MerchantStore|null>(null);
  readonly ingredients=signal<InventoryItem[]>([]);
  readonly stocktakes=signal<StocktakeRecord[]>([]);
  readonly loading=signal(true);
  readonly busy=signal(false);
  readonly error=signal("");
  readonly notice=signal("");
  readonly openItemId=signal("");
  readonly countTakeId=signal("");
  readonly countedOnHand=signal("");
  readonly countReason=signal("");
  readonly formatQuantity=formatUnits;
  readonly difference=stocktakeDifference;
  private openRetry:{itemId:string;key:string}|null=null;

  readonly openStocktakes=()=>this.stocktakes().filter((take)=>take.state==="open");
  statusLabel(state:StocktakeRecord["state"]):string {
    return ({open:"รอการตรวจนับ",submitted:"รอการอนุมัติ",
      approved:"อนุมัติแล้ว",rejected:"ปฏิเสธแล้ว"} as const)[state];
  }
  shortId(id:string|null):string {
    return id?id.slice(0,8)+"…":"—";
  }
  itemLabel(id:string):string {
    return this.ingredients().find((x)=>x.itemId===id)?.name??"วัตถุดิบ";
  }

  ngOnInit():void {void this.initialize();}
  private async initialize():Promise<void> {
    try {
      const {stores}=await this.merchant.stores();
      const found=stores.find((x)=>x.tenantId===this.tenantId &&
        x.storeId===this.storeId && x.role!=="cashier");
      if(!found)throw new Error("ไม่มีสิทธิ์เข้าถึง Stocktake ของร้านนี้");
      this.store.set(found);
      await this.reload();
    } catch(error) {
      this.error.set(message(error));
    } finally {this.loading.set(false);}
  }

  async reload():Promise<void> {
    if(!this.store())return;
    this.loading.set(true);
    this.error.set("");
    try {
      const [snapshot,list]=await Promise.all([
        this.inventory.snapshot(this.tenantId,this.storeId),
        this.inventory.stocktakes(this.tenantId,this.storeId),
      ]);
      this.ingredients.set(snapshot.items);
      this.stocktakes.set(list.stocktakes);
    } catch(error) {
      this.error.set(message(error));
    } finally {this.loading.set(false);}
  }

  setSelected(event:Event,field:"open"|"count"):void {
    if(!(event.target instanceof HTMLSelectElement))return;
    if(field==="open")this.openItemId.set(event.target.value);
    else this.countTakeId.set(event.target.value);
  }
  setText(event:Event,field:"count"|"reason"):void {
    if(!(event.target instanceof HTMLInputElement))return;
    if(field==="count")this.countedOnHand.set(event.target.value);
    else this.countReason.set(event.target.value);
  }

  async open(event:Event):Promise<void> {
    event.preventDefault();
    if(this.busy()||!["owner","manager"].includes(this.store()?.role??""))return;
    const itemId=this.openItemId();
    if(!this.ingredients().some((x)=>x.itemId===itemId)) {
      this.error.set("เลือกวัตถุดิบจากร้านก่อน");return;
    }
    try {
      const crypto=this.document.defaultView?.crypto;
      if(!crypto?.randomUUID)throw new Error("อุปกรณ์ไม่รองรับ UUID ที่ปลอดภัย");
      if(!this.openRetry||this.openRetry.itemId!==itemId)
        this.openRetry={itemId,key:crypto.randomUUID()};
      this.busy.set(true);
      this.error.set("");
      await this.inventory.openStocktake(this.tenantId,this.storeId,
        itemId,this.openRetry.key);
      this.openRetry=null;
      this.notice.set("เปิดรอบตรวจนับสำเร็จ");
      this.openItemId.set("");
      await this.reload();
    } catch(error){this.error.set(message(error));}
    finally {this.busy.set(false);}
  }

  async submitCount(event:Event):Promise<void> {
    event.preventDefault();
    if(this.busy()||!this.store())return;
    const id=this.countTakeId(),count=this.countedOnHand(),
      reason=this.countReason().trim();
    if(!this.openStocktakes().some((x)=>x.stocktakeId===id)||
      !validPhysicalCount(count)||reason.length<3||reason.length>200) {
      this.error.set("ตรวจสอบรอบ จำนวน และเหตุผล (3–200 อักขระ)");
      return;
    }
    this.busy.set(true);
    this.error.set("");
    try {
      await this.inventory.submitStocktake(this.tenantId,this.storeId,
        id,count,reason);
      this.countTakeId.set("");
      this.countedOnHand.set("");
      this.countReason.set("");
      this.notice.set("ส่งยอดตรวจนับสำเร็จ รอผู้อนุมัติอีกบัญชี");
      await this.reload();
    } catch(error){this.error.set(message(error));}
    finally {this.busy.set(false);}
  }

  async review(take:StocktakeRecord,approve:boolean):Promise<void> {
    if(this.busy()||take.state!=="submitted"||
      !["owner","manager"].includes(this.store()?.role??""))return;
    const decision=approve?"อนุมัติปรับยอดจริง":"ปฏิเสธรอบนี้";
    if(!this.document.defaultView?.confirm(
      "ยืนยัน"+decision+" สำหรับ "+this.itemLabel(take.itemId)+
      " ?\nหากยอดเปลี่ยนระหว่างตรวจนับ ระบบจะบล็อกการอนุมัติ"))return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.inventory.reviewStocktake(this.tenantId,this.storeId,
        take.stocktakeId,approve);
      this.notice.set(approve
        ?"อนุมัติแล้ว สต็อกถูกแก้ไขตามผลตรวจนับที่ยืนยันจากฐานข้อมูล"
        :"ปฏิเสธรอบตรวจนับแล้ว ไม่เปลี่ยนยอดสต็อก");
      await this.reload();
    } catch(error){this.error.set(message(error));}
    finally {this.busy.set(false);}
  }
}
