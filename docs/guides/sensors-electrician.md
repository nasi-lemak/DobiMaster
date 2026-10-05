# Electrician job sheet: fitting power sensors in a shop

This is the checklist to hand to the installer (a registered electrician), with the owner's steps before and after the visit. It covers observation only: the sensors watch power use and never control the machine. Coins keep working exactly as before.

**Time:** about half a day for a 10-machine shop.
**Cost:** about RM 150–250 per machine for the sensor and clamp, plus installation.

**What to buy** (models, quantities, rough prices) is in [sensors-buy-and-home-test.md](sensors-buy-and-home-test.md). Do the home test there first: it proves the setup works before anyone opens a distribution board.

## 1. Before the visit

- [ ] **List every machine:** code (W1, D3…), brand and model, washer or dryer, and whether a dryer is **gas or electric**.
- [ ] **Map the distribution board (DB).** Each machine needs its **own circuit** to clamp.
  - Stacked washer-dryer units are sometimes on one feed. One clamp can't tell the washer from the dryer, so plan a clamp for each unit's own supply, or ask the electrician whether they can be split.
- [ ] **Pick the Shelly model:**

  | Machine | Use | Why |
  |---|---|---|
  | Dryers, big (≥ 15 kg) and 3-phase washers | **Shelly EM Gen3** or **Pro EM** with a 50 A / 120 A clamp | Clamp-on, no break in the cable; two clamps = two machines per device |
  | Small single-phase washers (< 16 A) | Shelly EM (same as above), or **Plus 1PM / PM Mini Gen3** inline | The inline ones carry the full current, so max 16 A: **never on a dryer** |
  | Home testing, or a small washer on a 13 A socket | **Shelly Plus Plug UK** | Plug-in, no wiring. Max 13 A: **never on a commercial dryer** |

  3-phase machines: clamp **one** phase. That's enough to see the cycle.
- [ ] **Wi-Fi at the DB:** check the signal at the DB with a phone. If it's weak, add an access point or a 4G router.
- [ ] **Owner:** register each machine in DobiMaster first (Machines → Add).
- [ ] **Owner:** set the shop's electricity price (Shop settings → Electricity price, RM per kWh, from the TNB bill).

## 2. Installation (electrician)

Installation must be done by a registered wireman (Energy Commission rules). Nothing is modified inside the machines.

- [ ] Isolate the circuit. Fit the Shelly in the DB (DIN rail for Pro models, or an enclosure).
- [ ] Put the clamp around the **live** conductor of the machine's circuit only (not live + neutral together).
  - Which way round doesn't matter: the script handles a reversed clamp.
- [ ] Label each clamp and Shelly channel with the machine code, e.g. "EM #2 · clamp 1 = D3".
- [ ] Power up and join the Shelly to the shop Wi-Fi:
  - Use the Shelly app, or connect to its own hotspot and open 192.168.33.1.
  - Update the firmware.
  - Leave the time settings (NTP) on.

## 3. Connect each sensor to DobiMaster

For **each machine**:

- [ ] Go to DobiMaster → **Sensors** → **Register sensor**. Choose the shop, the machine, and kind **Shelly**.
- [ ] In the dialog, choose the Shelly model and channel (clamp 1 / clamp 2 / inline).
- [ ] Click **Copy script** (the URL, token and channel are already filled in) and paste it into:
  - Shelly web page → **Scripts** → **Create script** → **Save**.
  - Turn on **Run on startup** → **Start**.
- [ ] **Two machines on one Shelly EM:** register the second machine as well, then add its line to `channels` in the same script:
  - `{ component: "em1:1", token: "<second token>" }`
  - Use one script per device, not two.
- [ ] Keep the tokens safe: each one is shown only once. If one is lost, register that sensor again.

## 4. Check it works (don't skip)

- [ ] Within about a minute, the sensor shows **Online** on the Sensors page.
- [ ] Run **one real cycle on each machine model**. In the Machines view, check:
  - It shows **Running** within about 30 seconds of starting.
  - It stays Running through fill, soak and drain pauses.
  - It shows **Finished** a few minutes after the cycle really ends.
- [ ] If a cycle **splits in two** during a long soak or pause, or ends too late:
  - Note the machine model and tell us, so the detection timing can be tuned for that model.
  - Washers are allowed a 4-minute pause and dryers 90 s before a cycle counts as finished.
- [ ] **Gas dryers:** Running/Finished works, because the motor and fan draw power. The "heater may be failing" check does **not** apply, because a clamp can't see the gas burner.
- [ ] Unplug a Shelly for about 4 minutes to test alerts. You should get a **Sensor offline** alert, which clears when it's plugged back in.
  - If you switch off the whole shop's Wi-Fi, you should get one **shop offline** alert instead of one per machine.

## 5. After install

- [ ] Customers now see live availability, and "Notify me when free" appears when every machine of a size is busy.
- [ ] Owner: check **Analytics → Electricity per cycle** after a day of use.
- [ ] Keep the DB labels and the list of tokens and devices with the shop's records.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sensor never goes online | Script not started or "Run on startup" is off; no internet at the DB; wrong URL in the script |
| Shelly script log says "rejected the token" | Token mistyped, or the sensor was re-registered: copy the new script |
| Shelly script log says "unreachable" | Wi-Fi or internet down. Readings are buffered for about 10 minutes and sent when it's back |
| Machine never shows Running | Clamp on the wrong circuit or wrong channel in the script (clamp 1 vs 2) |
| Cycle splits into two | A pause longer than the detection allows. Report the model for tuning |
| Everything in the shop offline at once | Power cut, tripped main breaker or internet outage (one "shop offline" alert) |

The script source is [`devices/shelly/dobimaster-sensor.js`](../../devices/shelly/dobimaster-sensor.js). It is tested by running it against a simulated Shelly (`apps/api/test/shelly-script.test.ts`), but **it has not yet been run on a physical Shelly.** Do the one-cycle check in step 4 on the first real install.
