# Smart Dobi Platform: Competitor and Market Research Brief (Malaysia, 2026-09-30)

**Scope:** software-first platform that adds smart features to existing self-service laundromats ("dobi layan diri") without replacing machines, with optional low-cost retrofit IoT later.
**Method:** web search and page fetches on 2026-09-30, plus App Store review feeds (iTunes RSS, MY and US storefronts). Where a figure comes from a vendor's marketing blog, the brief says so. Anything I could not confirm is marked **unverified**.

**Source-quality warning:** many Malaysian cost and fee figures below come from *info.thelaundro.com*, the SEO blog of Laundro (Antlysis Design), which competes in this market. Treat those numbers as vendor claims.

---

## 0. Key takeaways

1. **Malaysia already has a crowded QR-retrofit market.** At least six local vendors sell boards that start existing machines by pulse injection and take DuitNow QR and e-wallets: Transpire QR, One Pay Technology, MyPayment Gateway, QR Pay For Vending (Edxapay), Laundro (Antlysis), Dobipay and Hiro. All of them sell **payment first**. None I found sells monitoring, operations or customer experience on its own, separate from payment.
2. **Big chains run their own closed stacks.** dobiQueen has its own app and token wallet. LaundryBar has LB Pay and an LB Franchise app. Cleanpro has the Cleanpro Plus web app and per-machine PayWave readers. Hiro/myDobi runs in Sabah and Sarawak. These apps get consistently poor reviews for login failures, top-up failures, "paid but machine didn't start", forced minimum top-ups and slow refunds.
3. **Global OEM platforms lock you to their own machines.** Examples are Speed Queen Insights (which is offered in Malaysia), DexterLive, Girbau Sapphire and Electrolux. Global third-party platforms (Cents/Laundroworks, PayRange, CCI, SpyderWash) depend on their own proprietary readers and are US-focused.
4. **Small tickets make payment-rail choice decisive.** A dobi ticket is RM4–10. FPX and card fees with a fixed ~RM1 component take 10–25% of that. DuitNow QR and e-wallets at about 1–1.5% with no fixed fee (CHIP, HitPay, Billplz wallets, Curlec) are the only sensible rails for per-cycle payment.
5. **The biggest gap is independent machine-state truth.** No one is selling "is this machine actually running, and did the payment match a cycle?" A per-machine current clamp would give it. It would enable automatic refunds, availability and "done" notifications, abandoned-laundry alerts, coin-revenue auditing and downtime alerts, and it works across any brand or payment system.

---

## 1. Global laundromat management and consumer apps

| Company / product | What it solves well | Needs proprietary machines or hardware? | Public pricing | Notable complaints |
|---|---|---|---|---|
| **CSC ServiceWorks / CSC GO** | Route operator for more than 1M machines in multi-housing and campuses. App pay and machine status. | CSC owns and operates the machines and readers. It is not sold to independent shops. | N/A (route model) | Machines take payment without running a cycle, slow repairs, refunds needing long forms or cheques ([BBB](https://www.bbb.org/us/ny/melville/profile/laundry-equipment/csc-serviceworks-inc-0121-73322/complaints), [JustUseApp](https://justuseapp.com/en/app/1552572916/csc-go/reviews)). In 2024 students found that the API trusted the client, which allowed free cycles and balance top-ups ([UCSC](https://news.ucsc.edu/2024/07/csw-laundry/), [DarkReading](https://www.darkreading.com/ics-ot-security/students-spot-washing-machine-app-flaw-that-gives-out-free-cycles)). US App Store 4.6 from about 173k ratings, but recent 1-star reviews cite "clothes don't dry… refunds are never distributed" (iTunes RSS, Sep 2026). |
| **PayRange** | Bluetooth "BluKey" retrofit. The phone provides connectivity, so the shop needs no internet. Works on coin machines. | Yes, a BluKey device per machine. | BluKey US$79.95 + $20 bundle fee; $35 activation per device; platform fee $0.99–1.50 per machine per week; processing 3.95% + $0.02 (US); minimum 10 machines ([PayRange pricing](https://payrange.com/payrange-pricing-plans/), [shop](https://shop.payrange.com/industries/laundry/)) | Recent reviews: can't find or connect to machine, Bluetooth permission confusion, double charges, fixed $5/$10 load amounts ("I need $7") (US iTunes RSS). PayRange licensed its tech to Electrolux Professional ([StreetInsider/PRN](https://www.streetinsider.com/PRNewswire/PayRange+to+License+Mobile+Payment+Technology+to+Electrolux+Professional+for+Laundry+Equipment/26936035.html)) and acquired TurnsApp, now "PayRange Insights" ([LinkedIn](https://www.linkedin.com/company/turnsapp), [PayRange](https://www.payrange.com/turns-app/)). |
| **Speed Queen Insights** (Alliance Laundry Systems; Huebsch has an equivalent) | Owner portal, customer app, Scan-Pay-Wash QR, CRM and rewards, error alerts, remote pricing ([SQ Insights](https://go.speedqueencommercial.com/insights-for-laundromats)). **Listed as available in Malaysia** ([SQ Malaysia](https://speedqueencommercial.com/my/)). | Yes. Needs Quantum Gold controls and factory wireless networking; "can be added to existing Speed Queen" ([SQ Quantum](https://speedqueencommercial.com/en-us/quantum-controls/)). Speed Queen and Huebsch only; no mixed fleets. | Not public (**unverified**) | App reviews: sign-up loops, "never works on washers", no refund option. Earlier reviews: top-ups only in fixed multiples, so leftover balance is stranded. |
| **Electrolux Professional** (Compass Pro controls, LaundryPay PRO app, One Connected Link) | Programmable controls; payment kits; app with loyalty ([EP payment systems](https://www.electroluxprofessional.com/commercial-laundry-equipment/payment-systems/), [LaundryPay PRO](https://apps.apple.com/us/app/laundrypay-pro/id6749643890)) | App and connectivity are tied to Electrolux machines. EP says its machines are "ready for connection with the vast majority of payment systems". | Not public | Not researched in depth. dobiQueen's franchise package uses Electrolux ([dobiQueen](https://www.dobiqueen.my/franchise-opportunity)). |
| **Dexter** (DexterLive + DexterPay) | Cloud reporting, remote vend, alerts. Pay per cycle with no preload. Loyalty ([DexterLive](https://www.dexter.com/vended-laundry/dexter-live/), [DexterPay](https://www.dexter.com/vended-laundry/dexterpay/)) | Dexter machines only. DexterLive network required; installs on Dexter machines "10+ years old". | "No setup fees", no annual fee, pay per use (rate not public) | DexterPay has a **1.9★ from 211 ratings** on the US App Store: double charges, unexpected pre-auth ($25 held for a $12.60 wash), login loops, no phone support (iTunes RSS). |
| **Continental Girbau – Sapphire** | Remote start and stop, promotions, consumption monitoring, per-machine billing reports; more than 500 laundries (per search summary of [Girbau](https://www.girbau.com/self-service-laundry/)) | Girbau machines | Not public | **Unverified** (no reviews found) |
| **Cents** (includes **Laundroworks**, acquired Aug 2024, and **Insight Systems**, acquired Jul 2026) | Most complete US SaaS: POS, wash-and-fold, delivery, machine management, marketing, AI receptionist. Raised a $140M Series C in Mar 2026; more than 5,000 locations ([Cents news](https://www.trycents.com/news/cents-acquires-insight-systems), [Cooley](https://www.cooley.com/news/coverage/2024/2024-08-08-cents-announces-40-million-series-b-financing-and-acquisition-of-laundroworks)) | Yes for self-serve payments: Penny reader, Pulse in-machine device, Pay kiosk, Laundroworks NFC readers and kiosk ([Cents Connect](https://www.trycents.com/news/cents-connect-announcement)) | Software $89 / $249 / $399 per month (self-serve), up to $599 multi-service; hardware bundles $2,000–3,500; AI receptionist $99 per month ([Cents pricing](https://www.trycents.com/pricing), [Laundroworks pricing](https://laundroworks.com/pricing)) | Not investigated in depth. Laundroworks payouts go through Stripe with a 2-business-day hold. |
| **CleanCloud** | POS and delivery for dry-cleaners and wash-and-fold (not machine control) | No machine hardware | $99 / $129 / $189 / $335 per month (per [Capterra/SoftwareAdvice summaries](https://www.capterra.com/p/133390/CleanCloud/pricing/)) | Not researched |
| **SpyderWash** (Setomatic) | Cards, loyalty and NFC while **keeping coins** | Yes, SpyderWash readers and kiosk ([Setomatic](https://setomaticsystems.com/laundry-card/)) | Dealer quote | Not researched |
| **WASH / WASH-Connect** | Multifamily route operator app | Operator-owned machines | N/A | 3.7★ on Google Play. Refund caps ("too many refunds"), refunds only within 3 days, machines not starting ([WASH refund page](https://www.wash.com/wash-connect-refund/), [AppGrooves](https://appgrooves.com/app/wash-connect-by-wash-multifamily-laundry-systems-llc/negative)) |
| **TurnsApp** | Wash-and-fold POS, branded apps, pickup and delivery | No | Not public | Acquired by PayRange (see above) |
| **LaundroLab** | **Not a software vendor.** It is a US chain of modern laundromats using Electrolux machines ([Yelp](https://www.yelp.com/biz/laundrolab-austin)). | n/a | n/a | n/a |
| **ShinePay** | QR plus smartphone card payments on Speed Queen coin machines; no Wi-Fi needed; "2-minute install" ([ShinePay](https://shinepay.co/speedqueen)) | Retrofit device, currently marketed for Speed Queen | Not public | Not researched |
| **Laundroworks** | NFC readers, value-add kiosk, loyalty cards | Yes (now Cents) | Plans $89–399 per month; hardware quoted separately | — |
| **Card Concepts (CCI) – LaundryCard / FasCard** | Card-only (LaundryCard, for 40+ machines) or hybrid with coins (FasCard). Multi-vend **serial** integration with Speed Queen Quantum, Maytag and Dexter ([CCI](https://www.laundrycard.com/products/), [compatibility](https://www.laundrycard.com/products/compatibility-guide/speed-queen/)) | Yes | Dealer listings cite roughly $2.2k to $30k systems (per [lowlaundry](https://www.lowlaundry.com/supplies/card-systems) search summary; **unverified**) | Not researched |
| **Hercules** (NY) | Multi-housing smart cards, Bluetooth app ([Hercules](https://hercnet.com/)) | Operator-owned | N/A | Settled a ~$2.4M class action over stranded card balances and a $5 fee to reclaim them ([TopClassActions](https://topclassactions.com/lawsuit-settlements/closed-settlements/hercules-laundry-card-2-4m-class-action-settlement/)) |
| **Nayax** (VPOS Touch) | Global unattended-payment reader (cards, NFC, QR), MDB/pulse | Yes, a reader per machine | Laundro's blog claims RM1,200–2,000 per reader in MY (**vendor claim**) | No Malaysian office found; the product appears on eBay Malaysia. Local availability or support is **unverified**. |

**Pattern:** every global product either (a) sells or requires its own reader or machine, or (b) is a route operator. Their shared consumer complaints are "charged but machine didn't start", refunds that are slow or capped, stranded wallet balances, and login and connectivity failures.

---

## 2. Malaysia and Southeast Asia

### 2.1 Malaysian chains

| Chain | Scale (claimed) | Payments / app | Machines | Franchise |
|---|---|---|---|---|
| **LaundryBar** (City Coin Sdn Bhd) | "850+ outlets" across MY, TH, BN, TR ([laundrybar.com.my](https://laundrybar.com.my/)). An older page says 350+ ([Own a LaundryBar](https://laundrybar.com.my/own-a-laundrybar-self-service-laundrybar-franchise-malaysia/)). | LB Pay app: scan the machine QR, pay by card, FPX or e-wallet ([LB Pay](https://play.google.com/store/apps/details?id=com.bugzstudio.laundrybar)). Also card kiosk, smart card, "Remote Return Coin System", token changers. Has a separate **LB Franchise** app for franchisees ([Play](https://play.google.com/store/apps/details?id=com.bugzstudio.lbfranchise)). | Exclusive ALS **IPSO** machines, plus a "3-in-1" machine | Claims ~30% ROI and roughly 18-month breakeven. Claims **zero royalty** (search summary). |
| **dobiQueen** (Foto-ZZoom Sdn Bhd) | 82 outlets in Klang Valley (Vulcan Post, 2023; [VP](https://vulcanpost.com/856848/dobiqueen-malaysia-self-service-laundrette-chain/)); now "80+" | App wallet of **tokens (1 token = RM1)**, topped up by e-wallet, card or FPX. Staff do wash-to-dry transfer and folding for about RM3 extra. Pickup and delivery. | Electrolux Professional | From RM380k; claims 35% ROI; forecast revenue RM283,576 per year ([franchise](https://www.dobiqueen.my/franchise-opportunity)) |
| **Cleanpro** (Cleanpro Express, Aladin Dobi, Ibu Sayang) | About 300 outlets in 2019 ([Visa](https://www.visa.com.my/about-visa/newsroom/press-releases/cleanpro-express-partners-visa-to-be-the-first-self-service-laundromat-chain-in-southeast-asia-to-accept-contactless-payments.html)). Operates in MY, TH and SG. | First SEA laundromat chain with Visa contactless (2019): a **per-machine PayWave terminal** ([how-to](https://www.cleanpro.asia/how-to-pay-with-paywave/)). **Cleanpro Plus** web app (2023): scan a QR with no app install, choose temperature or dryer time, top up by card or e-wallet, vouchers and referrals ([Cleanpro Plus](https://www.cleanpro.asia/cleanpro-plus/), [MFA](https://www.mfa.org.my/cleanpro-unveils-a-refreshed-brand-identity-and-new-cashless-payment-app/)) | Dexter, among others | Franchise fee RM50k, **royalty 10% + 1% A&P**, capex about RM450k (2016 listing; [iFranchise](https://ifranchisemalaysia.com/cleanpro-express-franchise-business-opportunity.html)) |
| **myDobi + Hiro** (Hiro Solution Sdn Bhd, Miri) | "150+ projects, 2,000+ machines, 3 countries"; largest in Sabah ([Borneo Post](https://www.theborneopost.com/2022/12/03/mydobi-largest-self-service-laundry-shop-in-sabah/)) | Hiro app wallet: **minimum top-up RM30, or a RM1.50 fee below that** (App Store reviews); removed S Pay Global in 2026. Hiro now sells as a platform: Hiro Link device, app, kiosk and Hiro Live ([hiro.my](https://hiro.my/)). | Mixed | Turnkey packages ([mydobi.my](https://mydobi.my/)) |
| **De Dobi** (Johor) | "34 branches, cashless" (FB snippet) | DeDobi app, **2.7★** on the MY App Store (71 ratings) | — | — |
| Others found | DobiBoy, Dobi Land (CS Laundry), Smart Laundry Concept (10+ outlets, consultant), Washupp ("first cashless smart laundry"), Dobi Kita (Langkawi), Laundryhub | Mostly coins/tokens plus QR | — | — |

**Could not verify as Malaysian laundry brands:**
- **"BlueDobi"**: no results at all.
- **"Dobi Pintar"**: no laundry brand found.
- **"WashStation"**: nothing in MY.
- **"Laundry Club"**: nothing in MY. A US "Laundry Club" may exist but was not checked.

"Smart Laundry" exists as several small unrelated shops or consultants, not one chain. **"Dobi Kita"** exists as a small Langkawi operator (4 × 14 kg washers) ([Wanderlog](https://wanderlog.com/place/details/11723657/dobi-kita-24-hours-self-service-laundry-padang-putih-outlet)).

### 2.2 Malaysian QR retrofit vendors (direct competitors to an optional IoT layer)

| Vendor | How it works | Pricing | Notes |
|---|---|---|---|
| **Transpire QR (TQR-DNQR Laundry)** | Pulse output (NO/NC/open collector); **dynamic DuitNow QR**; works with Primus, LG, Tolon, Fagor, Dexter, Speed Queen, Huebsch, Maytag, IPSO, Oasis, Haier, Octopus ([Transpire](https://www.transpire.com.my/Products/tqr_duitnow_qr_series_laundry)) | Not public | Owner console includes remote "credit inject" for refunds, fault push alerts, and online/offline status |
| **One Pay Technology** (Bukit Mertajam) | Custom plug-and-play IoT controller with OTA updates. DuitNow, TNG, GrabPay, ShopeePay, Boost, cross-border QR ([One Pay](https://onepaytechnology.com/)) | "Custom pricing" | Instant refund to e-wallet; installs in several states |
| **MyPayment Gateway** (Penang) | IoT QR for laundry, vending, claw machines. MY, SG, ID ([site](https://mypaymentgateway.com/)) | Quote | — |
| **QR Pay For Vending** (Edxapay, Cyberjaya) | 12 V pulse terminal, Wi-Fi, optional 4G, LCD and speaker ([site](https://qrpay4vending.com/)) | Not public | DuitNow, FPX, cards, TNG, ShopeePay, Alipay |
| **Laundro** (Antlysis Design) | Machine-agnostic pulse controllers, dynamic QR, remote refunds, dynamic pricing ([blog](https://info.thelaundro.com/top-5-coin-laundry-system-in-malaysia/)) | Claims RM3,500–8,000 for a store of about 10 machines (≈RM350–800 per machine) plus about RM600–900 per month for "internet/SaaS/cleaning" ([blog](https://info.thelaundro.com/how-to-start-a-self-service-laundry-business-in-malaysia-cost-equipment-licensing-guide-2026/)) | Positions itself against franchise lock-in |
| **Dobipay** | QR payment for laundromats | "From RM349 per machine" (search snippet only; site returned 404, **unverified**) | — |
| **Kiple** | DuitNow QR gateway and terminals ([Kiple](https://kiple.com/about-us/)) | — | Kiple prepaid cards are accepted on Cleanpro PayWave |
| **"Ezy Pay"** | **Not found as a vending-board vendor.** "Ezypay" is an AU/MY direct-debit subscription company ([ezypay.com/my](https://www.ezypay.com/my)). | — | — |

### 2.3 Regional equivalents

- **Thailand, Otteri Wash & Dry** (K-Nex): more than 1,200 branches and more than 1M customers. App payment plus coins and QR. Bank-financed franchise loans up to 110% of investment ([Krungsri](https://www.krungsri.com/en/newsandactivities/krungsri-banking-news/krungsri-launch-otteri-wash-dry-franchise)).
- **Thailand, WashXpress** (Laundry You PCL, SET: WASH): 561 branches as of 30 Sep 2025 (482 company-owned, 79 franchised). App with pay-without-coins, machine status and points. Wash-dry-fold at 221 branches ([Jitta](https://www.jitta.com/stock/bkk:wash)).
- **Singapore:** WonderWash has 100+ outlets, most 24/7, unattended, with cash, PayNow or app ([WonderWash](https://wonderwash.com.sg/)). The Daily Tumble uses a cashless kiosk. Hangout Laundry uses tokens via PayNow or cash and the Huebsch app ([Hangout](https://hangoutlaundry.sg/what-actually-makes-a-laundromat-worth-staying-in)). A "Wash & Fold" chain in SG was **not found**.
- **Indonesia:** a very cheap QRIS retrofit market. **LaundryGO** sells an external relay/Wi-Fi controller at **Rp 350,000 per machine (Rp 280,000 for 10+)** with **no monthly fee**. It earns money through an all-in MDR of 3.5%, 2.5% or 1.7% depending on tier ([LaundryGO](https://laundrygo.id/iot)). Also Smartlink, Saku Laundry, Laundry QRIS and IOTERA.
- **Philippines:** LG Laundry Lounge app with GCash; POS apps with GCash and Maya QR ([LaundryBizCenter](https://laundrybizcenter.com/news/lg-announces-launch-of-their-smart-app-in-the-laundry-lounge/)).

**Common features across SEA:** coin or token machines with changers are still the base layer. Central kiosks appear at premium chains. Per-machine QR is the dominant upgrade (DuitNow, QRIS, PromptPay, PayNow). Chains run app wallets with top-up bonuses. Franchise dashboards exist (LB Franchise). Assisted service upsells (wash-dry-fold) are common.

---

## 3. Malaysian payment rails and gateways

**Rails.** DuitNow QR (PayNet) is interoperable across banks and e-wallets. PayNet introduced a **0.25% DuitNow QR MDR** from 1 Nov 2023, with BNM/PayNet saying micro and small businesses would be exempt through an acquirer incentive fund ([SoyaCincau](https://soyacincau.com/2023/09/28/duitnow-qr-merchant-transaction-fees-confirmed/), [FintechNews](https://fintechnews.my/39863/payments-remittance-malaysia/paynet-bnm-clarify-the-duitnow-qr-transaction-fee-confusion/)). Current 2026 status is **unverified**. Gateways add their own margin on top.

| Gateway | DuitNow QR | E-wallets | FPX (B2C) | Cards (domestic) | Fixed / annual fees | Fee on a **RM5** ticket via cheapest local rail |
|---|---|---|---|---|---|---|
| **CHIP** ([pricing](https://www.chip-in.asia/pricing)) | 1.0%, min RM0.15 (online and in-person) | 1.4% | RM1.00 | 1.0% debit / 2.0% credit | None. Refund fee applies to FPX only (RM1). | DuitNow **RM0.15 (3%)** |
| **HitPay** ([pricing](https://hitpayapp.com/my/pricing)) | 1.2% | TNG 1.9%, GrabPay 2%, ShopeePay 2.2% | 1.8% + RM0.40 | 1.2% + RM1 | None; +0.2% if using its business tools | DuitNow **RM0.06 (1.2%)** |
| **Billplz** ([pricing](https://main.billplz.com/pricing), [malaysiapg](https://malaysiapg.com.my/gateway/billplz/)) | 1.5% (grouped with wallets) | 1.5% | **RM1.25 flat** (Basic) / RM0.75 (Standard, RM999 per year) | 1.8% / 1.5% | Standard plan RM999 per year | DuitNow RM0.075 (1.5%) |
| **Razorpay Curlec** ([pricing](https://curlec.com/pricing/)) | "DuitNow Pay" 1.2%, min RM0.30 (whether this is QR or online banking is **unverified**) | TNG and Boost 1.5%, GrabPay 1.5% | max(1.5%, RM1) | 2.4% | Premium setup RM999 | E-wallet RM0.075. Has a QR-code API with webhooks and a refund endpoint ([docs](https://curlec.com/docs/api/qr-codes/image-content/refunds/)). |
| **ToyyibPay** ([pricing](https://www.toyyibpay.com/pricing-plans/)) | "1.00% or RM1.00 per transaction" (wording ambiguous; if RM1 applies, that is 20% of RM5) | via DuitNow | RM1.00 | 1.5% + RM100 onboarding | — | FPX RM1 (20%) |
| **senangPay** (per [EasyStore](https://blog.easystore.co/en-my/what-you-need-to-know-about-senangpay)) | Not listed | max(RM0.65, 1.5%) | max(RM1, 1.5%) | max(RM0.65, 2.5%) | RM199–349 per year | E-wallet **RM0.65 (13%)** |
| **iPay88** (now under Adaptis, per [Simicart](https://simicart.com/blog/ipay88-price/); older data) | — | 2.6% or min RM0.60 | 2.6% or min RM0.60 | 2.5–2.7% | Setup RM488+; RM500 per year | **RM0.60 (12%)** |
| **Fiuu** (ex-Razer Merchant Services) | 1.0% online / 0.85% offline (2022 pricing appendix, [PDF](https://booster.fiuu.com/assets/Appendix_20220824034323.pdf)) | — | 2.4% or min RM0.60 | — | Quote only | DuitNow ~RM0.05 |
| **Stripe MY** ([pricing](https://stripe.com/en-my/pricing)) | **Not offered** | GrabPay 3% | 3% + RM1 | 3% + RM1 | None; disputes RM90 | GrabPay RM0.15; FPX/card **RM1.15 (23%)** |

**Implications for a laundry SaaS:**
- **Use per-transaction dynamic DuitNow QR** through CHIP, HitPay, Curlec or Fiuu. Put the machine ID and cycle in the order reference and start the machine from the webhook. Avoid FPX and cards for per-cycle payment.
- **Wallet top-ups are how chains cope with fixed fees**, and customers hate them. dobiQueen has a RM10 minimum. Hiro has a RM30 minimum or a RM1.50 fee below it: "machine to dry is RM10… need to top up RM11.50" (MY App Store reviews). A wallet also creates stored-value liabilities. Holding customer funds may raise BNM e-money questions (**unverified; get legal advice**). Hercules' US class action shows the risk of stranded balances.
- **Refunds:** CHIP charges only for FPX refunds; Stripe doesn't refund its fees. Whether e-wallet or DuitNow refunds via API are available at each gateway should be confirmed in sandbox (**partly unverified**). Hardware vendors mostly offer "credit inject", meaning refund as in-store credit.

---

## 4. Customer complaints about Malaysian self-service laundries

Evidence comes from App Store MY reviews (dobiQueen: 4.0★ from 639 ratings; Hiro/myDobi; DeDobi: 2.7★), Wanderlog/Google-review summaries, local blogs and Lowyat thread titles. Lowyat itself is behind Cloudflare and was not readable.

| Theme | Evidence |
|---|---|
| **Paid but machine didn't start / app–machine desync** | dobiQueen: "Token dalam apps dia tolak tp mesin x berfungsi" (tokens were deducted but the machine didn't work); "after scan mesin, mesin tak detect… bila sampai rumah dia running pula" (machine didn't respond to the scan, then started later after the customer got home); "top up dua kali tak masok token" (topped up twice, tokens never arrived). Hiro: "Device NOT FOUND" after a RM30 top-up; "app said wash ended but actually still have 5 minutes left". |
| **Machines eating coins, broken changers, no change** | LaundryBar Subang Bestari: "Some dryer machine will eat coin, not first time" ([Wanderlog](https://wanderlog.com/place/details/10316801/laundrybar-self-service-laundry-subang-bestari-u5)). Cleanpro KK: "coin machines are both broken. One is taped up"; customers go next door for change ([Wanderlog](https://wanderlog.com/place/details/10121699/cleanpro-express-self-service-laundry-kampung-air-kota-kinabalu)). Tokens from other shops jam machines. |
| **Dryers not drying / short cycles** | "Spent RM8 on supposed 40 minutes drying… ONLY 26 minutes" (Hiro review). Reports of dryers not fully drying at LaundryBar. The MaiCuci blog attributes much of this to overloading ([blog](http://maicuci.blogspot.com/2016/04/dobi-layan-diri-kesalahan-biasa.html)). |
| **App reliability: login, OTP, top-up failures** | This is the dominant 1-star theme for dobiQueen (2024–2026): OTP not received, login button not clickable on iOS, crashes after an update, "Don't put too much money inside this wallet". Accounts suspended with balance inside (for sharing with family). |
| **Refunds slow or impossible; wallet lock-in** | "No option to refund the coin back… minimum is RM10" (dobiQueen); "cannot withdraw from the apps" (Hiro); WhatsApp-only support is slow. |
| **Fees and price creep** | "RM1.50 processing fee" below the RM30 top-up (Hiro); "Makin hari makin naik harga" (prices keep going up) (dobiQueen); payment methods removed without notice (S Pay Global, Sarawak Pay on Hiro). |
| **Dirty premises, filters not cleaned, no water** | "garbage everywhere, dirty like hell" (LaundryBar Taman Sea, Apr 2025); "seldom see clean the machine filters"; "no water to wash your hand". |
| **Clothes left in machines / lost clothes** | Abandoned laundry at LaundryBar; MaiCuci provides baskets; "baju yang hilang… customer service pun out" (clothes went missing and customer service was unreachable) (dobiQueen). |
| **Waiting and crowding; no availability info** | "crowded evenings" (Cleanpro KK). Feature requests: "show availability of the machine", "add in-app timer", "track our clothes… does anyone disturb the machine", "detect errors from the machine… alert users" (dobiQueen and Hiro reviews). |
| **Unclear instructions and pricing** | A first-timer was "overwhelmed by… pricing variations"; a reviewer's tip is to use coins, not QR, if unfamiliar (Dobi Kita). |
| **Missing e-invoice or receipts** | "No receipt nothing" (dobiQueen 2024); "Cannot see the e-invoice" (Hiro 2026). |

Reddit r/malaysia threads specific to dobi complaints were **not found** by search, so that source is **unverified**.

---

## 5. Owner pain points

- **Coin handling and theft.** Coin boxes are broken into: RM580 stolen from a coin machine at Bandar Laguna Merbok ([Sinar Harian](https://www.sinarharian.com.my/article/656899/edisi/utara/terkejut-lihat-suspek-pecah-kedai-dobi-depan-mata)). Coin boxes get "torn apart", and people use changers for their own business (Lowyat snippets). **Token arbitrage** also happens: 73,000+ dobi tokens were sold on Shopee at 28 sen each in 2023 ([Lobak Merah](https://lobakmerah.com/pemilik-kedai-dobi-mungkin-rugi-besar-coin-dobi-dijual-serendah-28-sen-sekeping/)).
- **No telemetry on coin machines.** Owners cannot reconcile collected cash against cycles actually run, so leakage (staff skimming, jams, free-run faults) is invisible.
- **Downtime nobody reports.** "Nobody calls the owner when machines break down" and there is "no guarantee on how quick after-sales" service will be (Lowyat snippet). Water supply outages go unannounced (Cleanpro KK, myDobi Jesselton reviews).
- **Cleaning and maintenance.** Busy shops need filters cleaned twice a day (Lowyat snippet). Cleanliness is a top review complaint, and owners have no proof-of-cleaning.
- **Refunds and disputes** run over WhatsApp and phone. Vendors sell "remote credit inject" (Transpire) and "instant refund" (One Pay) as key features.
- **Franchise royalty reporting.** Cleanpro charges 10% royalty plus 1% A&P (2016). Laundro claims 3–8% of gross revenue is typical (vendor claim). Both sides need trusted revenue numbers. LaundryBar ships an LB Franchise app.
- **Economics.** The Laundro vendor model assumes 5 washers + 5 dryers, 1,000–1,200 sq ft, OPEX RM8.5k–13.4k per month, and revenue of RM16k (conservative), RM25–29k (healthy) or RM36k+ (high traffic) per month ([Laundro model](https://info.thelaundro.com/self-service-laundry-financial-modeling-roi-opex-breakdown-payback-analysis-2026/); vendor claim). dobiQueen forecasts RM283,576 per year (≈RM23.6k per month) per outlet.
- **Lock-in.** Franchise packages bundle proprietary kiosks and changers (Laundro claims RM15k–30k per store). OEM platforms work only with their own brand.

---

## 6. Retrofit IoT approaches

| Approach | How it works | Pros / cons | Rough cost |
|---|---|---|---|
| **Coin-pulse emulation** (used by almost all MY/ID QR boards) | Coin acceptors output NPN pulses of about 25–100 ms, one pulse per coin ([DG600F manual](https://cdn.sparkfun.com/datasheets/Components/General/6CoinAcc.pdf)). A board fires N pulses (via opto or relay) into the coin input to credit the machine. Transpire lists NO/NC/open-collector outputs. | Works on nearly any coin machine. **One-way:** the board doesn't know whether the machine actually started, which is the root of the "paid but didn't start" problem. Tampering with wiring may affect warranty or franchise terms (**unverified**). | ID: Rp280–350k (≈US$17–21) per machine. MY: RM349+ (Dobipay, unverified); RM350–800 per machine implied by Laundro. |
| **Relay/external-start controller** | Relay placed outside the machine closes a start circuit ([LaundryGO](https://laundrygo.id/iot)) | Simple, but also one-way | As above |
| **Serial / multi-vend** | Card readers speak the OEM's serial protocol (Speed Queen Quantum Gold/Silver/MDC, Maytag, Dexter C-series) ([CCI compatibility](https://www.laundrycard.com/products/compatibility-guide/speed-queen/)) | Two-way: price, status, error codes. Protocols are proprietary or licensed. | Reader hardware in the US$ hundreds (**unverified**) |
| **MDB** | Vending standard used by Nayax and others | Common in vending, rare in laundry controls | Nayax reader RM1.2–2k (vendor claim) |
| **Manufacturer cloud / API** | Speed Queen Insights, DexterLive, Girbau Sapphire, Electrolux | Rich data, but brand-locked. No public third-party APIs found (**unverified**). | Subscription (not public) |
| **Current sensing (CT clamp)** | A split-core CT on the machine's supply measures motor and heater current; thresholds give idle, running, spin or heat phases, and end-of-cycle. This is well established in home automation, e.g. "<5 W for 3 min = done" ([HA community](https://community.home-assistant.io/t/washing-machine-notification/531604), [Home Automation Guy](https://www.homeautomationguy.io/blog/home-assistant-automations/washing-machine-notifications)) | Non-invasive, brand-agnostic, **two-way truth** about whether a cycle ran and for how long. Commercial washers may be 3-phase: clamp one phase. LPG dryers show only motor or fan current, not whether the burner lit (**engineering inference**). | SCT-013 CT ≈US$6–10 ([circuitsetup](https://circuitsetup.us/product/100a-50ma-current-transformer-yhdc-sct-013/)); ESP32 board RM29–34 in MY ([Cytron NodeMCU-ESP32 RM29](https://my.cytron.io/p-nodemcu-esp32), [DigiKey MY RM33.71](https://www.digikey.my/en/products/detail/espressif-systems/ESP32-DEVKITM-1/13532113)); PZEM-004T Modbus meter module (price **unverified**, commonly low single-digit USD) |
| **Off-the-shelf energy monitors** | Shelly EM (2 channels, up to 120 A clamps) or Shelly Pro 1PM / Plus 1PM (inline, ≤16 A) with local HTTP/MQTT APIs | Fast to deploy; the 16 A inline limit and single-phase design suit small machines only | Shelly EM + 50 A clamp US$69.99 / €59.90 ([Shelly](https://www.shelly.com/products/shelly-em-50a-clamp-1)); Pro 1PM US$89.99; Plus 1PM ≈US$30 (AliExpress) |
| **Vibration / accelerometer** | Zigbee or ESP32 vibration sensor on the cabinet ([vibinator](https://github.com/jcostom/vibinator), [Kyle Niewiada](https://www.kyleniewiada.org/blog/2020/07/appliance-notifications-through-vibration-and-power/)) | Zero electrical work. Noisy in rows of machines, since neighbouring machines cause crosstalk. | ESP32 + MPU6050 ≈RM40–60 (**estimate**) |
| **Exhaust temperature sensor (dryers)** | DS18B20 or thermocouple on the dryer exhaust | Catches the "dryer not heating" problem that a CT on an LPG dryer can't see | < RM20 per sensor (**estimate**) |

**Rough bill of materials for a per-machine "state sensor":** ESP32 (RM30) + CT (RM25–40) + enclosure, PSU and connectors (RM30–50, **estimate**) ≈ **RM90–120 per machine**. That is about 10 machines for RM1,000–1,200 per shop, below the RM3.5k–8k claimed for QR retrofit packages.

---

## 7. Typical Malaysian dobi pricing, size and hours

| Item | Observed values | Source |
|---|---|---|
| Washer, 9–10 kg | RM4.00–4.50 (Fresh2O 9 kg RM4; EcoGreen 10 kg RM4.50); user-reported RM5–7 | TallyPress list via search snippet (page 404); [Lemon8](https://www.lemon8-app.com/@ryssa_02/7419677042813239809?region=my) |
| Washer, 14 kg | RM6 (Dobi Kita, cold); RM8–10 (user report) | [Wanderlog](https://wanderlog.com/place/details/11723657/dobi-kita-24-hours-self-service-laundry-padang-putih-outlet), Lemon8 |
| Large washer (up to 25 kg) | up to RM14 (Granny Laundry) | TallyPress snippet |
| Dryer | RM4 (Cleanpro KK, EcoGreen 14 kg); RM4 for 24 min; RM4–6 for 20–30 min; RM5 (Dobi Kita); **RM8–10** at myDobi (Sabah/Sarawak) | Wanderlog, Lemon8, App Store |
| Dryer top-up | RM1 per 5 min (≈RM0.20 per minute) (Cleanpro) | search summary |
| Wash + dry per visit | RM10–15 (dobiQueen); "RM12" typical; Laundro models RM12 average (RM7 + RM5) | [Lemon8](https://www.lemon8-app.com/wendiyy_/7422957424211968513?region=my), Laundro |
| Tokens | RM1 per token (dobiQueen); RM0.50 tokens (Laundry Buddy) | as above |
| Assisted add-on | Transfer and fold about RM3 (dobiQueen) | App Store review |
| Shop size | 4–6 washer-dryer stacks or 8–12 drums; 5W + 5D in 1,000–1,200 sq ft; Dobi Kita has 4 washers | Laundro blogs, Wanderlog |
| Capex | RM180k–380k (Laundro); RM250k–500k ([Launch Laundry](https://launchlaundry.com.my/how-much-does-it-cost-to-start-a-self-service-laundry-in-malaysia/)); dobiQueen from RM380k; Cleanpro RM450k (2016) | as cited |
| Hours | Chains are **24/7**: LaundryBar "24/7, 365", dobiQueen 24 h, WonderWash SG 24/7. "7am–midnight" shops exist anecdotally (**unverified**). | chain sites |
| **Willingness to pay for software** | Weak direct evidence. The Laundro model budgets **RM600–900 per month for internet + SaaS + cleaning**. Franchisees already pay 3–10% royalties. Indonesian vendors charge no subscription and monetize through MDR markup (1.7–3.5%). US benchmarks: PayRange ≈US$4–6.5 per machine per month; Cents US$89–399 per store per month. A plausible MY anchor is **RM150–400 per store per month, or about RM10–30 per machine per month, or ~1% of processed revenue** (**my inference, not evidenced**). | as cited |

---

## 8. Opportunities and gaps for inexpensive hardware plus good software

1. **Machine-state truth that works with any brand and any payment system.** Build a CT-clamp and ESP32 sensor (about RM100 per machine) that reports idle, running, spin, done and fault. No Malaysian vendor sells monitoring separately from payment, and every QR board is one-way pulse injection. A state sensor sits alongside coins, tokens, any QR board, PayWave or an OEM system, so it needs no rip-and-replace and doesn't conflict with franchise payment stacks.
2. **Automatic "paid but didn't start" detection and refund.** Match each payment event (webhook) to a current-rise within about 60 s. If none arrives, auto-credit or refund and alert the owner. This targets the #1 complaint across dobiQueen, Hiro, CSC, WASH and DexterPay reviews. Refunds become a rule, not a WhatsApp dispute. Refund caps like WASH's are unnecessary when the data proves the fault.
3. **Coin-shop revenue auditing.** In coin-only shops, compare cycles counted per machine × price list against coins collected, and flag the variance per machine and per collection. This addresses theft, staff skimming, jammed or "eat coin" machines, free-run faults and token arbitrage. No competitor serves the large base of pure-coin independents without selling them a payment board first.
4. **Live availability, timers and "done" alerts without an app.** Use a web page or QR per shop, plus WhatsApp or Telegram notifications. Reviewers explicitly ask for this ("show availability", "in-app timer", "track our clothes"). Cleanpro's no-install web app shows customers accept QR-to-web-page.
5. **Abandoned-laundry handling.** When a cycle is done but the door stays unopened for N minutes, remind the customer, then flag staff to move items to a basket. Tie this to machine turnover.
6. **Dryer-effectiveness and short-cycle detection.** Measure actual run minutes against minutes paid for (the "40 min paid, 26 min ran" complaint). Add an optional exhaust-temperature probe to catch dryers that aren't heating, a problem a CT can't see on LPG dryers.
7. **Downtime and utility alerts.** Detect machines with no cycles during peak hours, repeated short or aborted cycles, offline nodes, and water-pump or tank failures (optional sensor on the pump circuit). Push these to the owner or technician. Owners say "nobody calls when machines break."
8. **Micropayment-sane payments, as an optional layer.** Use per-cycle dynamic DuitNow QR at about 1–1.2% (CHIP or HitPay), confirmed by the machine-state sensor. Avoid the forced RM10–30 wallet top-ups and RM1.50 fees that customers resent, and avoid stored-value regulatory exposure (**verify with BNM rules**). Starting machines can still use existing third-party pulse boards or a simple opto-isolated pulse output.
9. **Cleanliness and operations checklists with proof.** Staff scan a shop QR and upload photos for filter and lint cleaning and floor checks. Include a customer-facing "report a problem with machine #5" QR that captures a photo and auto-links the machine's state history. This directly targets the "dirty, filters not cleaned" reviews.
10. **Franchise and multi-outlet reporting with independent verification.** Sensor-derived cycle counts give franchisors and franchisees a neutral revenue estimate for royalty checks (royalties are 3–10%) across mixed payment systems.
11. **Receipts and e-invoice.** Customers complain of no receipts or e-invoices. Issuing digital receipts per cycle is cheap. Malaysian e-invoicing (MyInvois) obligations for small operators should be checked (**unverified**).
12. **Security by design.** The CSC GO API flaw (client-trusted balances) is a cautionary tale. Keep balance and authorization server-side, sign device commands, and rate-limit starts.
13. **Pricing model to test.** A low-capex sensor kit (sold at cost, or rented at about RM10–15 per machine per month) plus a store SaaS at RM150–400 per month. Alternatively, a small take rate only when payments are processed. This undercuts QR-board packages (RM3.5k–8k claimed) and franchise tech fees (**pricing hypotheses, not evidenced**).

**Main competitive risks:**
- Local QR vendors (Transpire, One Pay, Hiro, Laundro) could add clamp-based state sensing.
- Speed Queen Insights is already marketed in Malaysia for Speed Queen fleets.
- Chains may keep everything in-house.

**Differentiation to hold:** be the neutral data and operations layer that works *with* whatever payment hardware is there, and win on reliable refunds and customer notifications.

---

### Items explicitly unverified or not found
- BlueDobi, Dobi Pintar, WashStation (MY), Laundry Club (MY), "Wash & Fold" chain (SG): **not found**.
- "Ezy Pay" vending boards: **not found**. Ezypay is a direct-debit company.
- Nayax local presence in MY: **unverified**.
- Dobipay RM349 per machine: search snippet only.
- Speed Queen Insights, Girbau Sapphire and Electrolux connectivity pricing: **not public**.
- Current 2026 DuitNow QR MDR waiver status: **unverified**.
- Refund-API support for DuitNow QR at each gateway: confirmed for Curlec (docs), otherwise **unverified**.
- PZEM-004T and Malaysian Shelly retail prices: **unverified**.
- SaaS willingness-to-pay figures in section 7 beyond Laundro's OPEX line: **inference**.
