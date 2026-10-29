// DalaChain: блокчейннің негізгі логикасы
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DIFFICULTY = 4;          // хеш неше нөлден басталуы керек
const MINING_REWARD = 50;      // майнерге берілетін сыйақы
const START_BALANCE = 100;     // жаңа әмиянға берілетін бастапқы сома
const SYSTEM = "SYSTEM";       // жүйелік транзакциялардың жіберушісі
const DATA_FILE = path.join(__dirname, "data", "state.json");

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Транзакцияның қол қойылатын мазмұны
function txPayload(tx) {
  return JSON.stringify([tx.from, tx.to, tx.amount, tx.timestamp, tx.type]);
}

function txId(tx) {
  return sha256(txPayload(tx) + (tx.signature || ""));
}

// Блоктың хеші: блоктағы барлық деректен есептеледі
function blockHash(block) {
  return sha256(JSON.stringify([
    block.index, block.timestamp, block.prevHash, block.nonce,
    block.transactions.map(txId),
  ]));
}

function addressFromPublicKey(publicKeyHex) {
  return "D" + sha256(publicKeyHex).slice(0, 39);
}

class Blockchain {
  constructor() {
    this.chain = [];
    this.pending = [];
    this.wallets = {};   // address -> { name, publicKey }
    this.backup = null;  // бұрмалауға дейінгі көшірме
    if (!this.load()) {
      this.chain.push(this.mineBlock({
        index: 0, timestamp: Date.now(), prevHash: "0".repeat(64), transactions: [],
      }).block);
      this.save();
    }
  }

  // ---------- сақтау ----------
  load() {
    try {
      const s = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      this.chain = s.chain; this.pending = s.pending; this.wallets = s.wallets;
      return this.chain.length > 0;
    } catch (e) {
      return false;
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        chain: this.chain, pending: this.pending, wallets: this.wallets,
      }));
    } catch (e) {
      console.error("Сақтау қатесі:", e.message);
    }
  }

  // ---------- майнинг (Proof-of-Work) ----------
  mineBlock(block) {
    const target = "0".repeat(DIFFICULTY);
    const started = Date.now();
    block.nonce = 0;
    block.hash = blockHash(block);
    while (!block.hash.startsWith(target)) {
      block.nonce += 1;
      block.hash = blockHash(block);
    }
    return { block, attempts: block.nonce + 1, ms: Date.now() - started };
  }

  get lastBlock() {
    return this.chain[this.chain.length - 1];
  }

  // ---------- әмияндар ----------
  createWallet(name) {
    name = String(name || "").trim().slice(0, 40);
    if (!name) throw new Error("Әмиян иесінің атын жазыңыз");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const publicHex = publicKey.toString("hex");
    const address = addressFromPublicKey(publicHex);
    this.wallets[address] = { name, publicKey: publicHex };
    // бастапқы баланс келесі блокта расталады
    this.pending.push({
      from: SYSTEM, to: address, amount: START_BALANCE, timestamp: Date.now(),
      type: "start", signature: null,
    });
    this.save();
    return { address, name, privateKey: privateKey.toString("hex"), publicKey: publicHex };
  }

  balance(address) {
    let confirmed = 0;
    for (const b of this.chain) {
      for (const tx of b.transactions) {
        if (tx.to === address) confirmed += tx.amount;
        if (tx.from === address) confirmed -= tx.amount;
      }
    }
    let pendingOut = 0, pendingIn = 0;
    for (const tx of this.pending) {
      if (tx.from === address) pendingOut += tx.amount;
      if (tx.to === address) pendingIn += tx.amount;
    }
    return { confirmed, available: confirmed - pendingOut, pendingIn, pendingOut };
  }

  history(address) {
    const list = [];
    this.chain.forEach((b) => b.transactions.forEach((tx) => {
      if (tx.from === address || tx.to === address) list.push({ ...tx, id: txId(tx), block: b.index });
    }));
    this.pending.forEach((tx) => {
      if (tx.from === address || tx.to === address) list.push({ ...tx, id: txId(tx), block: null });
    });
    return list.reverse();
  }

  // ---------- транзакциялар ----------
  addTransaction({ from, to, amount, privateKey }) {
    amount = Number(amount);
    if (!this.wallets[from]) throw new Error("Жіберуші әмиян табылмады");
    if (!this.wallets[to]) throw new Error("Алушы әмиян табылмады");
    if (from === to) throw new Error("Өзіңізге жіберуге болмайды");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сома оң сан болуы керек");

    // жеке кілт осы әмиянға тиесілі ме
    let keyObject;
    try {
      keyObject = crypto.createPrivateKey({ key: Buffer.from(privateKey, "hex"), format: "der", type: "pkcs8" });
    } catch (e) {
      throw new Error("Жеке кілт дұрыс емес");
    }
    const derivedPublic = crypto.createPublicKey(keyObject).export({ type: "spki", format: "der" }).toString("hex");
    if (addressFromPublicKey(derivedPublic) !== from) throw new Error("Бұл жеке кілт осы әмиянға тиесілі емес");

    if (this.balance(from).available < amount) throw new Error("Қаражат жеткіліксіз");

    const tx = { from, to, amount, timestamp: Date.now(), type: "transfer" };
    tx.signature = crypto.sign("sha256", Buffer.from(txPayload(tx)), keyObject).toString("hex");
    if (!this.verifyTx(tx)) throw new Error("Қолтаңба тексерілмеді");
    this.pending.push(tx);
    this.save();
    return { ...tx, id: txId(tx) };
  }

  verifyTx(tx) {
    if (tx.from === SYSTEM) return tx.signature === null;
    const w = this.wallets[tx.from];
    if (!w || !tx.signature) return false;
    try {
      const pub = crypto.createPublicKey({ key: Buffer.from(w.publicKey, "hex"), format: "der", type: "spki" });
      return crypto.verify("sha256", Buffer.from(txPayload(tx)), pub, Buffer.from(tx.signature, "hex"));
    } catch (e) {
      return false;
    }
  }

  // ---------- жаңа блок ----------
  mine(miner) {
    if (!this.wallets[miner]) throw new Error("Майнер әмияны табылмады");
    const reward = {
      from: SYSTEM, to: miner, amount: MINING_REWARD, timestamp: Date.now(),
      type: "reward", signature: null,
    };
    const result = this.mineBlock({
      index: this.chain.length,
      timestamp: Date.now(),
      prevHash: this.lastBlock.hash,
      transactions: [reward, ...this.pending],
    });
    this.chain.push(result.block);
    this.pending = [];
    this.backup = null;
    this.save();
    return result;
  }

  // ---------- тізбекті тексеру ----------
  validate() {
    const errors = [];
    const target = "0".repeat(DIFFICULTY);
    this.chain.forEach((b, i) => {
      if (blockHash(b) !== b.hash) errors.push({ index: i, reason: "Блоктың мазмұны өзгерген: хеш сәйкес емес" });
      if (!b.hash.startsWith(target)) errors.push({ index: i, reason: "Proof-of-Work орындалмаған" });
      if (i > 0 && b.prevHash !== this.chain[i - 1].hash) errors.push({ index: i, reason: "Алдыңғы блокқа сілтеме бұзылған" });
      b.transactions.forEach((tx, k) => {
        if (!this.verifyTx(tx)) errors.push({ index: i, reason: `${k}-транзакцияның қолтаңбасы жарамсыз` });
      });
    });
    return { valid: errors.length === 0, errors };
  }

  // ---------- шабуыл демонстрациясы ----------
  tamper(index, txIndex, amount) {
    const b = this.chain[index];
    if (!b || index === 0) throw new Error("Бұрмалау үшін 1-ден бастап блок таңдаңыз");
    const tx = b.transactions[txIndex];
    if (!tx) throw new Error("Мұндай транзакция жоқ");
    if (!this.backup) this.backup = JSON.parse(JSON.stringify(this.chain));
    tx.amount = Number(amount);
    return this.validate();
  }

  remineFrom(index) {
    if (!this.backup) throw new Error("Алдымен блокты бұрмалаңыз");
    let attempts = 0, ms = 0;
    for (let i = Math.max(1, index); i < this.chain.length; i++) {
      this.chain[i].prevHash = this.chain[i - 1].hash;
      const r = this.mineBlock(this.chain[i]);
      attempts += r.attempts; ms += r.ms;
    }
    return { attempts, ms, ...this.validate() };
  }

  restore() {
    if (!this.backup) throw new Error("Қалпына келтіретін ештеңе жоқ");
    this.chain = this.backup;
    this.backup = null;
    return this.validate();
  }

  stats() {
    const txCount = this.chain.reduce((s, b) => s + b.transactions.length, 0);
    const supply = this.chain.reduce((s, b) => s + b.transactions
      .filter((t) => t.from === SYSTEM).reduce((a, t) => a + t.amount, 0), 0);
    return {
      blocks: this.chain.length, transactions: txCount, pending: this.pending.length,
      wallets: Object.keys(this.wallets).length, difficulty: DIFFICULTY,
      reward: MINING_REWARD, startBalance: START_BALANCE, supply,
      lastHash: this.lastBlock.hash, tampered: !!this.backup,
    };
  }
}

module.exports = { Blockchain, sha256, txId, blockHash, DIFFICULTY };
