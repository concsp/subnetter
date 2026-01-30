/* ================= IPv4 helpers ================= */
const ipToInt = ip => ip.split('.').reduce((a,o)=>(a<<8)+(+o),0)>>>0;
const intToIp = n => [n>>>24,n>>>16&255,n>>>8&255,n&255].join('.');
const maskFromPrefix = p => p===0 ? 0 : (0xffffffff<<(32-p))>>>0;

function normalizeIp(v){
  try { return intToIp(ipToInt(v.trim())); } catch { return null; }
}

function normalizeCidr(v){
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  return t.startsWith("/") ? t : "/" + t;
}

function subnetInfo(net,p){
  const size = 2**(32-p);
  return {
    prefix:p,
    mask:intToIp(maskFromPrefix(p)),
    network:intToIp(net),
    broadcast:intToIp((net + size - 1) >>> 0),
    gateway:intToIp((net + 1) >>> 0),
    last:intToIp((net + size - 2) >>> 0),
    blockSize:size
  };
}

function hostsToPrefix(h){
  return 32 - Math.ceil(Math.log2(h + 2));
}

function randInt(min, maxIncl){
  return Math.floor(Math.random() * (maxIncl - min + 1)) + min;
}

/* ================= Private address pools ================= */
const POOLS = [
  { net: ipToInt("10.0.0.0"), prefix: 8 },
  { net: ipToInt("172.16.0.0"), prefix: 12 },
  { net: ipToInt("192.168.0.0"), prefix: 16 },
];

function randomBlockInSupernet(superNet, superPrefix, targetPrefix){
  const superSize = 2**(32-superPrefix);
  const targetSize = 2**(32-targetPrefix);
  const blocks = superSize / targetSize;
  const idx = randInt(0, blocks - 1);
  return (superNet + idx * targetSize) >>> 0;
}

function randomAssignedBlockByPrefix(targetPrefix){
  const validPools = POOLS.filter(p => p.prefix <= targetPrefix);
  const pool = validPools[randInt(0, validPools.length - 1)];

  const net = pool.prefix === targetPrefix
    ? pool.net
    : randomBlockInSupernet(pool.net, pool.prefix, targetPrefix);

  return { net, prefix: targetPrefix };
}

/* ================= Difficulty selection ================= */
function pickAssignedPrefix(diff){
  if (diff === "medium"){
    const r = Math.random();
    if (r < 0.60) return 24;
    if (r < 0.90) return 16;
    return 8;
  }
  return [24,16,8][randInt(0,2)];
}

/* ================= Host requirement generators ================= */
function genHostsEasy(basePrefix){
  const maxByBase = basePrefix >= 24 ? 200 : basePrefix >= 16 ? 2000 : 8000;
  return [randInt(10, Math.min(400, maxByBase))];
}

function genHostsMedium(basePrefix, count){
  const MEDIUM_MAX_HOSTS = 4094;
  const minSubnetPrefix = Math.min(30, basePrefix + Math.ceil(Math.log2(count)));
  const subnetPrefix = Math.max(minSubnetPrefix, 20);
  const usable = (2**(32-subnetPrefix)) - 2;

  const cap = Math.min(usable, MEDIUM_MAX_HOSTS);
  const floor = Math.max(30, Math.floor(cap * 0.35));
  const ceil  = Math.max(floor, Math.floor(cap * 0.75));
  const h = randInt(floor, ceil);

  return Array(count).fill(h);
}

function genHostsHard(basePrefix, count){
  const maxByBase = basePrefix >= 24 ? 200 : basePrefix >= 16 ? 2000 : 8000;
  const reqs = [];

  for (let i=0;i<count;i++){
    const roll = Math.random();
    let h;
    if (roll < 0.45) h = randInt(2, 60);
    else if (roll < 0.85) h = randInt(61, Math.min(300, maxByBase));
    else h = randInt(301, maxByBase);
    reqs.push(h);
  }
  return reqs;
}

/* ================= Allocation logic ================= */
function totalAllocatedFromHosts(hostReqs){
  const prefixes = hostReqs.map(hostsToPrefix);
  const total = prefixes.reduce((sum,p)=> sum + (2**(32-p)), 0);
  return { prefixes, total };
}

function buildAllocations(base, prefixes){
  let cursor = base.net;
  const allocs = [];

  for (const p of prefixes){
    const size = 2**(32-p);
    cursor = Math.ceil(cursor/size)*size;
    allocs.push(subnetInfo(cursor,p));
    cursor = (cursor + size) >>> 0;
  }
  return allocs;
}

/* ================= AI walkthrough link ================= */
function buildAiLink(base, hosts){
  const q =
`show a detailed step-by-step walkthrough explaining how to subnet ${intToIp(base.net)}/${base.prefix}
into ${hosts.length} subnets with host requirements ${hosts.join(", ")}.
Include how to determine subnet sizes, CIDR prefixes, network IDs, broadcast addresses, and usable host ranges.`;

  return `https://www.google.com/search?udm=50&aep=11&q=${encodeURIComponent(q)}`;
}

/* ================= UI wiring ================= */
const els = {
  difficulty: document.getElementById("difficulty"),
  newBtn: document.getElementById("newBtn"),
  checkBtn: document.getElementById("checkBtn"),
  question: document.getElementById("question"),
  inputs: document.getElementById("inputs"),
  result: document.getElementById("result"),
};

let current = [];
let expectedHosts = [];
let currentBase = null;

/* ================= Scoreboard + anti-farming ================= */

const SCORE_KEY = "subnetter_best_streak";
let streakNow = 0;
let streakBest = Number(localStorage.getItem(SCORE_KEY) || "0");

// Anti-farming flags
let questionScored = false;     // once true, you cannot gain streak again until New Question
let inputsTouched = false;      // optional: require user to change at least one input before check

const streakNowEl = document.getElementById("streakNow");
const streakBestEl = document.getElementById("streakBest");
const scorebarEl = document.getElementById("scorebar");

// Toast + modal elements
const toastEl = document.getElementById("toast");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalReview = document.getElementById("modalReview");
const modalNew = document.getElementById("modalNew");

function renderScore(){
  if (streakNowEl) streakNowEl.textContent = String(streakNow);
  if (streakBestEl) streakBestEl.textContent = String(streakBest);
}
renderScore();

function pulse(el){
  if (!el) return;
  el.classList.add("pulse");
  setTimeout(()=>el.classList.remove("pulse"), 600);
}

function showToast(text){
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.style.display = "block";
  pulse(toastEl);
  setTimeout(()=>{ toastEl.style.display = "none"; }, 2200);
}

function openModal(title, body){
  if (!modalBackdrop) return;
  modalTitle.textContent = title;
  modalBody.innerHTML = body;
  modalBackdrop.style.display = "flex";
}

function closeModal(){
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "none";
}

modalReview?.addEventListener("click", () => {
  closeModal();

  // optional: scroll to the explanations after closing
  document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
modalNew?.addEventListener("click", () => { closeModal(); newQuestion(); });
modalBackdrop?.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});


/* ================= Rendering ================= */
function renderQuestion(diff){
  els.question.style.display = "";

  const reminder = diff === "hard"
    ? `<div class="small" style="margin-top:8px;">
         <i>In VLSM, allocate address space from the largest requirement downward.</i>
       </div>`
    : "";

  els.question.innerHTML = `
    <b>Assigned block:</b> <code>${intToIp(currentBase.net)}/${currentBase.prefix}</code>
    <div class="small" style="margin-top:6px;">Requirements (largest first):</div>
    <ul style="margin:10px 0 0 18px;">
      ${expectedHosts.map((h,i)=>`<li><b>Subnet ${i+1}</b>: ${h} hosts</li>`).join("")}
    </ul>
    ${reminder}
  `;
}

function renderInputs(){
  els.inputs.innerHTML = current.map((_,i)=>`
    <div class="subnet">
      <div class="subnetHeader">
        <div><b>Subnet ${i+1}</b> <span class="small">(${expectedHosts[i]} hosts)</span></div>
        <div class="status" id="s${i}">—</div>
      </div>

      <div class="grid">
        <div><label>Mask</label><input data-i="${i}" data-f="mask"></div>
        <div><label>CIDR</label><input data-i="${i}" data-f="cidr"></div>
        <div><label>Network ID</label><input data-i="${i}" data-f="network"></div>
        <div><label>Broadcast</label><input data-i="${i}" data-f="broadcast"></div>
        <div><label>First usable (Gateway)</label><input data-i="${i}" data-f="gateway"></div>
        <div><label>Last usable</label><input data-i="${i}" data-f="last"></div>
      </div>
    </div>
  `).join("");

    // Mark inputs as touched if user edits anything (helps prevent "check blank" spam)
  inputsTouched = false;
  els.inputs.querySelectorAll("input[data-f]").forEach(inp => {
    inp.addEventListener("input", () => { inputsTouched = true; }, { passive: true });
  });
}

function collectRow(i){
  const box = els.inputs.querySelectorAll(".subnet")[i];
  const inputs = [...box.querySelectorAll("input[data-f]")];
  const obj = {};
  for (const inp of inputs) obj[inp.dataset.f] = inp.value;
  return obj;
}

/* ================= Question generation ================= */
function newQuestion(){
  els.result.style.display = "none";
  els.result.innerHTML = "";

  questionScored = false;
  inputsTouched = false;


  const diff = els.difficulty.value;
  const assignedPrefix = pickAssignedPrefix(diff);
  currentBase = randomAssignedBlockByPrefix(assignedPrefix);

  const count = diff === "easy" ? 1 : randInt(2,5);

  let hostReqs =
    diff === "easy" ? genHostsEasy(currentBase.prefix) :
    diff === "medium" ? genHostsMedium(currentBase.prefix, count) :
    genHostsHard(currentBase.prefix, count);

  hostReqs.sort((a,b)=>b-a);

  const baseBlock = 2**(32-currentBase.prefix);
  for (let tries=0; tries<250; tries++){
    const calc = totalAllocatedFromHosts(hostReqs);
    if (calc.total <= baseBlock){
      expectedHosts = hostReqs;
      current = buildAllocations(currentBase, calc.prefixes);
      renderQuestion(diff);
      renderInputs();
      return;
    }

    hostReqs =
      diff === "easy" ? genHostsEasy(currentBase.prefix) :
      diff === "medium" ? genHostsMedium(currentBase.prefix, count) :
      genHostsHard(currentBase.prefix, count);

    hostReqs.sort((a,b)=>b-a);
  }
}

/* ================= Answer checking ================= */
function checkAnswers(){
  // Anti-farming: don't allow scoring the same question multiple times
  if (questionScored){
    showToast("Already checked — generate a new question to continue your streak.");
    pulse(scorebarEl);
    return;
  }

  // Optional: require user to actually type something before checking
  if (!inputsTouched){
    showToast("Enter your answers first.");
    return;
  }


  let okAll = true;
  const explain = [];

  for (let i=0;i<current.length;i++){
    const c = current[i];
    const u = collectRow(i);

    const good =
      (u.mask || "").trim() === c.mask &&
      normalizeCidr(u.cidr) === `/${c.prefix}` &&
      normalizeIp(u.network) === c.network &&
      normalizeIp(u.broadcast) === c.broadcast &&
      normalizeIp(u.gateway) === c.gateway &&
      normalizeIp(u.last) === c.last;

    const status = document.getElementById("s"+i);

    if (good){
      status.textContent = "✔ Correct";
      status.className = "status good";
    } else {
      okAll = false;
      status.textContent = "✖ Incorrect";
      status.className = "status bad";

      explain.push(
`Subnet ${i+1} (${expectedHosts[i]} hosts)

Correct values:
  Mask: ${c.mask}
  CIDR: /${c.prefix}
  Network ID: ${c.network}
  Broadcast: ${c.broadcast}
  First usable (Gateway): ${c.gateway}
  Last usable: ${c.last}

Solve method:
  1) Choose the smallest prefix that supports ${expectedHosts[i]} hosts.
  2) Allocate largest requirements first (VLSM).
  3) Block size = ${c.blockSize} addresses.
`);
    }
  }

  els.result.style.display = "";

  if (okAll){
    questionScored = true;        // lock scoring for this question
    streakNow += 1;

    let newBest = false;
    if (streakNow > streakBest){
      streakBest = streakNow;
      localStorage.setItem(SCORE_KEY, String(streakBest));
      newBest = true;
    }

    renderScore();
    pulse(scorebarEl);

    if (newBest){
      showToast(`New best streak: ${streakBest} 🔥`);
    } else {
      showToast(`Correct — streak: ${streakNow}`);
    }

    els.result.innerHTML = `<b style="color:var(--good)">All subnets correct.</b>`;
  } else {
    questionScored = true; // also lock scoring; you must get a new question

    const endedAt = streakNow;
    streakNow = 0;
    renderScore();
    pulse(scorebarEl);

  openModal(
    "Streak ended",
    `
  <b>Your streak:</b> ${endedAt}<br>
  <b>Best streak:</b> ${streakBest}<br><br>
  Review the correct answers below to see where the calculation went wrong.
  `
  );

    const link = buildAiLink(currentBase, expectedHosts);
    els.result.innerHTML = `
      <details open>
        <summary>Show correct answers & explanations</summary>
        <pre>${explain.join("\n\n")}</pre>
        <div style="margin-top:10px;">
          <a href="${link}" target="_blank">Ask AI to explain how to solve this (detailed walkthrough)</a>
        </div>
      </details>
    `;
  }
}

/* ================= Event listeners ================= */
els.newBtn.addEventListener("click", newQuestion);
els.checkBtn.addEventListener("click", checkAnswers);

newQuestion();
