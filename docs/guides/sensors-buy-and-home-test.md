# Sensors: what to buy, and a test at home first

**For:** the owner. **No electrician needed** for the home test.

Sensors are optional. A shop works fully with QR stickers alone, with status coming from customers' check-ins. Adding a sensor to a machine turns its status into **live, measured status**, and unlocks extra features:
- "Notify me when free",
- electricity cost per cycle,
- "heater may be failing" alerts.

Sensors only **watch** how much power a machine uses. They never switch or control it, and coins keep working exactly as before.

## What to buy

**Prices are rough Malaysian online-retail estimates (Shopee / Lazada / local Shelly resellers). They have not been checked; confirm before ordering.**

Rules that apply to everything below:
- **Only Shelly Gen2 / Plus, Gen3 or Pro models work.** They run DobiMaster's small on-device script.
- **Gen1 can't be used.** The original "Shelly EM" and "Shelly 1PM" have no scripting.
- **Avoid Tuya, Sonoff and generic smart plugs.** They report to their maker's cloud, not to DobiMaster.

### A. Home test kit

| Item | Qty | Est. price | Notes |
|---|---|---|---|
| **Shelly Plus Plug UK** | 1 | ~RM 90–130 | Malaysia uses UK (BS 1363) sockets. Max 13 A (~3 kW), which suits home washers and tumble dryers. **Never use it on a commercial dryer.** |

### B. Pilot shop (about 10 machines; fitted by a registered electrician)

| Item | Qty | Est. price | Notes |
|---|---|---|---|
| **Shelly Pro EM-50** (recommended) | 1 per 2 machines | ~RM 300–400 | **Mounts on the DIN rail** inside the board like a breaker. **Clamp-on**: the machine's current never passes through it. **Wired network port** as well as Wi-Fi, which matters because Wi-Fi inside a metal board is often weak. |
| or **Shelly EM Gen3** | 1 per 2 machines | ~RM 200–280 | Same clamp approach, for boards with no DIN space. Wi-Fi only. |
| **Extra 50 A clamp (CT)** for that model | as needed | ~RM 40–70 | Use the clamp made for that model. Check how many come in the box. Use 120 A clamps only for very large machines. |
| **Shelly PM Mini Gen3** (optional) | small washers only | ~RM 70–100 | Inline, max 16 A. **Never on dryers.** |
| **4G router + prepaid data SIM** (only if the board has no network) | 1 | ~RM 150–250 + ~RM 30/month | Budget about 0.5 GB per sensor per month until measured (estimate). |

For 10 machines, hardware is roughly **RM 1,500–2,200** with Pro EM-50s, or **RM 1,200–1,700** with EM Gen3s (estimates), plus about half a day of electrician labour.

## Home test with the Shelly Plus Plug UK (about 30 minutes)

This proves the whole loop on a real machine, with no shop and no electrician:
- Wi-Fi and the script,
- Running → Finished,
- the "almost done" alert,
- energy per cycle.

It's also the first test of the script on a real Shelly, so **please report back what happens** (see the end of this section).

1. **Set up a test shop in DobiMaster.** This can be your real account. Keep the shop unpublished (don't press "Go live") until you're ready.
   - Add one washer that matches your home machine.
   - Start the setup wizard at `/owner/signup`, or use **Machines → Add machines** in an existing account.
2. **Connect the plug to Wi-Fi.**
   - Plug the Shelly into the wall, then connect it to your home Wi-Fi with the Shelly Smart Control app.
   - In the app, update its firmware and note its IP address.
3. **Register it in DobiMaster.**
   - Go to **Sensors → Register sensor**.
   - Choose your test shop and the washer, with kind **Shelly**.
   - For the model and channel, choose **"Shelly Plus Plug UK"**.
4. **Install the script.**
   - Click **Copy script**.
   - On a computer on the same Wi-Fi, open `http://<plug IP>`, then go to **Scripts → Create script**.
   - Paste the script and **Save**.
   - Turn on **Run on startup**, then press **Start**.
5. **Check it's online.** Within about a minute the sensor shows **Online** on the Sensors page.
6. **Run a real wash.**
   - Plug the washer into the Shelly and start a normal programme.
   - In DobiMaster → Machines, it should show **Running** within about 30 seconds and stay Running through fill, soak and spin pauses.
   - After the wash ends, it should show **Finished** within about 5 minutes.
7. **Try it as a customer.** On your phone:
   - Open the machine's customer page: Machines → the washer → "QR sticker" → scan it, or tap **Copy link** and open it on your phone.
   - Tap "I've started it — notify me" during the next wash, and turn on notifications.
   - You should get the "almost done" and "finished" alerts.

**Report back:**
- Did it go Running and Finished at the right times?
- Did the wash ever **split into two cycles** during a long soak?
- What does the script log say? Shelly web page → Scripts → the script → console.
- Your washer's brand and model.

This tunes cycle detection for real machines.

## Next

When the home test works, take [sensors-electrician.md](sensors-electrician.md) and the hardware above to a registered electrician for the shop install.
