// DobiMaster power sensor — runs ON a Shelly Gen2/Gen3/Pro device (Scripts page).
//
// Reads the machine's power every few seconds and sends it to DobiMaster, which works out when a
// cycle starts and ends. Fast reports while the machine runs, a heartbeat every minute when idle,
// and a small buffer so a short Wi-Fi drop doesn't lose readings.
//
// Written for Shelly's scripting engine (a restricted JavaScript): no arrow functions, template
// strings, classes, spread or async — keep it that way when editing.
//
// Setup: DobiMaster → Sensors → register the sensor → copy the generated script (URL, token and
// channel are filled in for you) → Shelly web UI → Scripts → Add script → paste → Save → enable
// "Run on startup" → Start.

let CONFIG = {
  url: "__INGEST_URL__",
  // One entry per monitored machine. A Shelly EM (Gen3 / Pro) has two clamp channels: em1:0 and em1:1.
  // Plus 1PM / Pro 1PM: switch:0. PM Mini Gen3: pm1:0.
  channels: [{ component: "__COMPONENT__", token: "__TOKEN__" }],
  sampleSec: 5, // how often to read power
  runningW: 25, // above this the machine counts as running → report quickly
  sendRunningSec: 10, // report interval while running
  sendIdleSec: 60, // heartbeat while idle (DobiMaster marks a sensor offline after ~3 missed)
  maxBuffer: 120, // readings kept per channel while offline (10 min at 5 s)
  maxBatch: 60, // readings per request
};

let state = [];
for (let i = 0; i < CONFIG.channels.length; i++) {
  state.push({ buf: [], lastSent: 0, inFlight: false, wasActive: false, failures: 0 });
}

function nowSec() {
  let sys = Shelly.getComponentStatus("sys");
  return sys && sys.unixtime ? sys.unixtime : null;
}

function readPower(component) {
  let st = Shelly.getComponentStatus(component);
  if (!st) return null;
  let w = typeof st.act_power === "number" ? st.act_power : st.apower;
  if (typeof w !== "number") return null;
  // A clamp fitted the wrong way round reports negative power; the magnitude is what matters.
  return Math.abs(Math.round(w * 10) / 10);
}

function isActive(buf) {
  for (let i = 0; i < buf.length; i++) if (buf[i].powerW > CONFIG.runningW) return true;
  return false;
}

function send(idx, now) {
  let ch = CONFIG.channels[idx];
  let st = state[idx];
  if (st.inFlight || st.buf.length === 0) return;
  let n = Math.min(st.buf.length, CONFIG.maxBatch);
  let batch = st.buf.slice(0, n);
  st.inFlight = true;
  Shelly.call(
    "HTTP.Request",
    {
      method: "POST",
      url: CONFIG.url,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + ch.token },
      body: JSON.stringify({ samples: batch }),
      timeout: 10,
    },
    function (res, errCode, errMsg) {
      st.inFlight = false;
      if (errCode === 0 && res && res.code >= 200 && res.code < 300) {
        st.buf.splice(0, n); // only drop what the server accepted
        st.lastSent = now;
        st.failures = 0;
        if (st.buf.length > 0) send(idx, now); // catch up after an outage
      } else {
        st.failures++;
        // Unknown token / removed sensor: say so in the Shelly log instead of retrying silently.
        if (res && (res.code === 401 || res.code === 403)) print("DobiMaster rejected the token for " + ch.component + " — register the sensor again");
        else if (st.failures % 12 === 1) print("DobiMaster unreachable (" + (res ? res.code : errMsg) + "), buffering " + st.buf.length + " readings");
      }
    }
  );
}

function tick() {
  let now = nowSec();
  for (let i = 0; i < CONFIG.channels.length; i++) {
    let st = state[i];
    let w = readPower(CONFIG.channels[i].component);
    if (w === null) continue;
    if (now === null) {
      // Clock not synced yet: without timestamps the server can only use the latest reading.
      st.buf = [{ powerW: w }];
    } else {
      st.buf.push({ ts: now * 1000, powerW: w });
      if (st.buf.length > CONFIG.maxBuffer) st.buf.splice(0, st.buf.length - CONFIG.maxBuffer);
    }
    let active = isActive(st.buf);
    let t = now === null ? 0 : now;
    let due = t - st.lastSent >= (active ? CONFIG.sendRunningSec : CONFIG.sendIdleSec);
    // Report the moment a machine starts or stops, not at the next interval.
    if (due || active !== st.wasActive || now === null) send(i, t);
    st.wasActive = active;
  }
}

Timer.set(CONFIG.sampleSec * 1000, true, tick);
print("DobiMaster sensor script running for " + CONFIG.channels.length + " channel(s)");
