'use strict'

const path = require('path')
const bedrock = require('bedrock-protocol')

/**
 * ISANC BotManager
 * ------------------------------------------------------------------
 * Auth flow (Microsoft device code, event handling status/chat/entity) di file
 * ini dipertahankan dari versi yang sudah kamu tes & jalan.
 *
 * Yang DIPERBAIKI di versi ini: pergerakan, lompat, sneak, pukul (attack/break
 * block), dan taruh block. Sebelumnya semua itu pakai packet `move_player` /
 * `player_action` yang dikirim CLIENT -> SERVER — itu sebabnya tidak
 * berpengaruh: di semua versi Bedrock modern, server yang jadi otoritas
 * pergerakan & pemecahan block (server-authoritative movement & block
 * breaking, lihat catatan resmi di minecraft-data types.yml field
 * `TransactionUseItem.action_type.break_block`: "When using server auth
 * block breaking ... this is never sent. Instead, block actions are
 * supplied in Player Auth Input."). Jadi packet yang benar buat SEMUA
 * input pemain (jalan, lompat, sneak, mulai/lanjut mecah block) adalah
 * `player_auth_input`, dikirim SETIAP TICK (termasuk saat diam/AFK — kalau
 * tidak dikirim rutin bot bisa "freeze"/dianggap invalid oleh server, lihat
 * https://github.com/PrismarineJS/bedrock-protocol/discussions/566).
 *
 * Referensi field diambil langsung dari skema resmi (bukan tebakan):
 * https://github.com/PrismarineJS/minecraft-data/blob/master/data/bedrock/latest/proto.yml
 * https://github.com/PrismarineJS/minecraft-data/blob/master/data/bedrock/latest/types.yml
 * (packet_player_auth_input, InputFlag, packet_inventory_transaction, Transaction,
 * TransactionUseItem)
 *
 * Kalau server tujuan pakai versi Minecraft yang jauh lebih lama dan menolak
 * packet ini, kemungkinan besar field di sini yang perlu disesuaikan — cek
 * proto.yml/types.yml versi yang sesuai di link atas.
 * ------------------------------------------------------------------
 */

const bots = new Map()

const TICK_MS = 50 // 1 tick Minecraft = 50ms (20 tick/detik)
const MOVE_SPEED = 0.2 // block per tick, kira-kira kecepatan jalan normal
const AFK_INTERVAL_MS = 20000 // jitter anti-kick tiap 20 detik
const CHAT_LOG_LIMIT = 200
const ATTACK_RANGE = 3.5
const BREAK_BURST_MS = 8000 // lama "nahan klik kiri" tiap kali tombol pukul ditekan - sebelumnya
// 1500ms, kenaikan ke 8000ms karena mecah block di survival pake tangan kosong/tool lemah
// bisa makan waktu berdetik-detik (block keras kayak batu jauh lebih lama dari 1.5 detik)

// Simulasi gravitasi lokal SEKEDAR APROKSIMASI (bukan physics asli - kita nggak
// punya data chunk/block jadi nggak bisa deteksi tanah beneran). Nilainya niru
// physics vanilla Minecraft per-tick (gravity 0.08, drag/air resistance 0.98,
// kecepatan awal lompat 0.42). Tujuannya cuma biar posisi Y yang kita kirim ke
// server nggak diem konstan pas nggak nginjek tanah (itu bikin server/anti-cheat
// ngeliat kita kayak "melayang" dan nolak gerakan). Posisi asli tetap dari
// server lewat move_player/correct_player_move_prediction (lihat _tick()).
const GRAVITY = 0.08
const AIR_DRAG = 0.98
const JUMP_VELOCITY = 0.42
const JUMP_AIR_MS = 700 // perkiraan lama lompat normal (naik+turun) buat fallback onGround, lihat jump()
const ACTION_CONFIRM_TIMEOUT_MS = 2500 // lama nunggu update_block sebagai bukti pukul/taruh kepakai server

// Dua hal ini nggak ada di versi sebelumnya, ditambahkan berdasarkan catatan
// debugging anti-cheat (kick dalam ~10 detik pertama setelah spawn):
const TICK_JITTER_MS = 4 // +/- ms acak di interval kirim player_auth_input
const SPAWN_GRACE_MS = 3000 // tunda AKSI AKTIF (lompat/pukul/taruh) sesaat setelah spawn

function nowId () {
  return 'bot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function clamp (v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function deg2rad (d) {
  return (d * Math.PI) / 180
}

// Vektor hadap (dunia) dari yaw, konvensi Bedrock: yaw 0 menghadap +Z
function forwardVector (yawDeg) {
  const rad = deg2rad(yawDeg)
  return { x: -Math.sin(rad), z: Math.cos(rad) }
}

function dist3 (a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// item kosong ("tangan kosong") - network_id 0 valid buat held_item di transaksi
// TAPI CUMA buat tipe `Item` (dipakai TransactionUseItem/taruh block), yang
// field-nya conditional: kalau network_id 0, field lain SKIP (lihat types.yml
// `Item._: network_id? if 0: void`).
const EMPTY_ITEM = { network_id: 0 }

// BUG YANG DIPERBAIKI (penyebab "Attack gagal: SizeOf error for undefined"):
// held_item buat item_use_on_entity (nyerang entity) itu tipe `ItemV4`, yang
// SKEMANYA BEDA dari `Item` - field count/metadata/block_runtime_id/extra_data
// SELALU wajib ada apa pun nilai network_id-nya (nggak ada percabangan "kalau
// 0 skip" kayak di `Item`, lihat types.yml `ItemV4:` - flat, semua field
// wajib). EMPTY_ITEM di atas cuma punya network_id, jadi field `extra_data`
// (tipe ByteArray) yang hilang bikin serializer coba baca Buffer dari
// `undefined` -> persis pesan error yang muncul. Fix-nya: buat objek "tangan
// kosong" versi ItemV4 yang lengkap, khusus buat nyerang entity.
const EMPTY_ITEM_V4 = { network_id: 0, count: 0, metadata: 0, block_runtime_id: 0, extra_data: Buffer.alloc(0) }

function isEmptyItem (item) {
  return !item || !item.network_id
}

// StackNetworkID item ini kalau ada (dibawa item.net_id_variant, cuma keisi kalau tipenya
// 'item_stack_net_id' - lihat types.yml ItemV4NetIdVariant). Dipakai clickContainerSlot()
// buat ngisi field `stack_id` di ItemStackRequest, yang menurut skema dicek server buat
// mastiin kita nggak "salah sangka" isi slot itu (misal barusan berubah). Kalau nggak ada
// (item lama/server nggak kirim), fallback 0 - beberapa server toleran, beberapa nolak;
// itu sebabnya clickContainerSlot() tetap kasih feedback jujur lewat item_stack_response.
function stackIdOf (item) {
  if (item && item.net_id_variant && item.net_id_variant.type === 'item_stack_net_id') {
    return item.net_id_variant.id
  }
  return 0
}

function toTransactionItem (item) {
  if (isEmptyItem(item)) return EMPTY_ITEM
  return {
    network_id: item.network_id,
    count: item.count || 1,
    metadata: item.metadata || 0,
    has_stack_id: 0,
    block_runtime_id: item.block_runtime_id || 0,
    extra: item.extra
  }
}

class Bot {
  constructor (id, config) {
    this.id = id
    this.config = config
    this.client = null
    this.status = 'connecting' // connecting | awaiting_auth | authenticated | joined | spawned | kicked | disconnected | error
    this.msaCode = null
    this.error = null
    this.kickReason = null

    this.runtimeId = null
    this.position = { x: 0, y: 64, z: 0 }
    this._lastSentPos = { x: 0, y: 64, z: 0 }
    this.yaw = 0
    this.pitch = 0
    this.onGround = true
    this.health = 20
    this._authTick = 0n

    this.chat = []
    this.entities = new Map() // runtime_id (BigInt) -> { uniqueId, position, name, kind }
    this.playersOnline = 0

    this.inventory = [] // ItemNew[] mentah dari inventory_content, index = slot (0-8 hotbar, 9-35 tas)
    this.selectedHotbarSlot = 0
    this._velY = 0 // kecepatan vertikal lokal, buat aproksimasi gravitasi di _tick()

    // Nama item (runtime_id -> nama, mis. "minecraft:diamond_sword") dikirim server SEKALI
    // lewat packet item_registry pas awal join. Field `network_id` di tiap slot inventory/
    // container itu angka runtime yang cuma valid buat SESI INI (beda tiap dunia/server),
    // makanya harus dipetakan balik ke nama lewat tabel ini biar enak dibaca di UI.
    this._itemNames = new Map()

    // Chest/container yang lagi kebuka (hasil tombol "Buka Chest"). windowId dipakai buat
    // nyocokin inventory_content/inventory_slot mana yang punya isi container ini (bukan
    // tas utama kita), dan buat container_close pas ditutup.
    this.container = { open: false, windowId: null, windowType: null, position: null, slots: [] }
    this._pendingContainerOpen = null // { pos, at } - nunggu konfirmasi container_open dari server
    this._pendingContainerOpenTimeout = null

    // Counter buat request_id di packet item_stack_request (dipakai clickContainerSlot()) -
    // WAJIB unik per request biar balasan item_stack_response bisa dicocokin balik lewat
    // _pendingStackRequests. Server nggak peduli urutannya asal nggak dobel dalam 1 sesi.
    this._stackRequestId = 0
    this._pendingStackRequests = new Map() // request_id -> { desc, at, timeout }

    this.moveState = { forward: false, back: false, left: false, right: false, sneak: false }
    this.afk = false
    this._jumpTicks = 0
    this._airborneSince = 0 // timestamp waktu terakhir kali onGround jadi false, dari SUMBER MANAPUN (lihat _setOnGround)
    this._prevSneak = false // buat deteksi tepi start_sneaking/stop_sneaking, lihat _tick()

    // Konfirmasi pukul/taruh block dari server (lihat listener 'update_block'
    // di connect() dan penjelasan di attack()/placeBlock()).
    this._pendingBlockAction = null // { kind: 'pecah'|'taruh', pos: {x,y,z}, at: timestamp }
    this._pendingBlockTimeout = null

    // Otopilot jalan ke koordinat (fitur "goto")
    this.autoWalk = null // { x, y, z } - y boleh null (nggak dipakai, cuma jalan datar)
    this._autoWalkStuckPos = null
    this._autoWalkStuckTicks = 0

    // state buat "pukul/mecah block" (block_action di player_auth_input)
    this._breaking = false
    this._breakPos = null
    this._breakFace = 1
    this._breakFirstTick = false
    this._breakTimeout = null

    // state buat "taruh block" - one-shot, ditempelin ke field `transaction` di
    // player_auth_input tick berikutnya (lihat _tick() dan placeBlock()). BUKAN
    // dikirim sebagai paket inventory_transaction berdiri sendiri lagi - itu
    // yang bikin server (anti-cheat ketat) ngabaikan diam-diam karena gak
    // nyambung ke tick dunia, beda dari block_action (pukul) yang emang dari
    // awal udah lewat player_auth_input dan kebukti dapet balesan server.
    this._pendingPlace = null

    this._moveTimer = null
    this._afkTimer = null
    this._spawnedAt = 0 // dipakai _warmedUp(), diisi pas event 'spawn'
  }

  // Dipakai jump()/attack()/placeBlock() buat nolak aksi aktif dalam beberapa
  // detik pertama setelah spawn (SPAWN_GRACE_MS). player_auth_input "diam"
  // tetap jalan terus dari _tick() selama grace ini (WAJIB, biar nggak
  // dianggap freeze) - yang ditunda cuma aksi yang lebih berat kayak
  // start_jumping/inventory_transaction, yang menurut catatan debugging bisa
  // ditolak/di-flag kalau server belum selesai kirim full_chunk_data.
  _warmedUp () {
    return this._spawnedAt > 0 && (Date.now() - this._spawnedAt) >= SPAWN_GRACE_MS
  }

  _warmupChat (aksi) {
    const sisaMs = SPAWN_GRACE_MS - (Date.now() - this._spawnedAt)
    this.pushChat({
      system: true,
      message: 'Masih warm-up (~' + Math.max(1, Math.ceil(sisaMs / 1000)) + ' detik lagi) - ' +
        aksi + ' ditunda dulu biar nggak keanggep gerakan invalid sama server.'
    })
  }

  pushChat (entry) {
    this.chat.push({ ...entry, at: Date.now() })
    if (this.chat.length > CHAT_LOG_LIMIT) this.chat.shift()

    // Hook opsional: backend memakai ini untuk menyalurkan pesan bot
    // (chat masuk dari pemain/server) ke feed realtime. Tidak mengubah
    // perilaku apa pun kalau callback tidak dipasang.
    if (typeof this.onChatMessage === 'function') {
      try {
        this.onChatMessage({
          botName: this.config && this.config.name ? this.config.name : null,
          system: !!entry.system,
          source: entry.source || null,
          message: entry.message || ''
        })
      } catch (_) { /* feed tidak boleh mengganggu alur bot */ }
    }
  }

  // BUG YANG DIPERBAIKI (penyebab regresi "lompat sekarang malah gabisa"):
  // versi sebelumnya cuma nyetel timer "anggap sudah mendarat" pas KITA
  // SENDIRI yang mulai lompat. Tapi onGround juga bisa jadi false dari SUMBER
  // LAIN (misal server ngirim koreksi on_ground:false karena kita kepental
  // dikit, atau jalan dari tepi). Kalau itu terjadi di server yang jarang
  // ngirim koreksi on_ground:true balik, bot kekunci nganggep diri "di udara
  // selamanya" dan jump() nolak terus. Sekarang SEMUA jalur yang bikin
  // onGround jadi false wajib lewat fungsi ini, jadi timer fallback-nya
  // konsisten nyala nggak peduli penyebabnya, dan bakal otomatis pulih abis
  // JUMP_AIR_MS walau server nggak pernah ngasih konfirmasi baliknya.
  _setOnGround (grounded) {
    if (grounded) {
      this.onGround = true
      this._airborneSince = 0
    } else if (this.onGround) {
      this.onGround = false
      this._airborneSince = Date.now()
    }
  }

  // Kasih tau jujur ke user kalau server baru aja "narik balik" posisi bot
  // secara signifikan - biasanya artinya gerakan/tindakan barusan DITOLAK
  // server (anti-cheat, nabrak sesuatu, atau di luar jangkauan yang
  // diperbolehkan), bukan cuma koreksi micro yang wajar tiap saat.
  //
  // BUG YANG DIPERBAIKI (false alarm abis pindah server/lobi, mis. `/server
  // ekonomi`): move_player.mode punya nilai 'teleport'/'reset' buat
  // reposisi YANG MEMANG DISENGAJA server (pindah dunia, portal, command
  // /tp, dll) - itu BUKAN penolakan gerakan, jadi jangan dilaporkan sebagai
  // "kemungkinan ditolak". Ditambah grace period sesaat sesudah teleport
  // (posisi masih suka "settle" beberapa kali dalam 1-2 detik pertama).
  _reportServerCorrection (newPos, mode) {
    if (mode === 'teleport' || mode === 'reset') {
      this._teleportGraceUntil = Date.now() + 2000
      return
    }
    if (this._teleportGraceUntil && Date.now() < this._teleportGraceUntil) return

    const moved = dist3(this.position, newPos)
    if (moved < 1.0) return
    const now = Date.now()
    if (this._lastCorrectionMsgAt && now - this._lastCorrectionMsgAt < 4000) return
    this._lastCorrectionMsgAt = now
    this.pushChat({
      system: true,
      message: 'Server barusan narik balik posisi bot sejauh ~' + moved.toFixed(1) + ' blok - kemungkinan gerakan/tindakan tadi ditolak (anti-cheat, nabrak, atau nggak valid).'
    })
  }

  // Ubah 1 slot mentah (ItemNew/ItemV4 dari protokol) jadi bentuk simpel buat dikirim ke
  // frontend: null kalau kosong, atau { name, count } kalau ada isinya. Nama diambil dari
  // tabel _itemNames (diisi dari packet item_registry) - kalau belum ketemu (server belum
  // kirim/item custom), fallback tampilin "item #<network_id>" daripada kosong tanpa info.
  _simplifySlot (item) {
    if (isEmptyItem(item)) return null
    const raw = this._itemNames.get(item.network_id)
    const name = raw ? raw.replace(/^minecraft:/, '') : ('item #' + item.network_id)
    return { name, count: item.count || 1 }
  }

  // Bentuk array 36 slot tetap (0-8 hotbar, 9-35 tas utama) biar frontend gampang render
  // grid tanpa perlu mikirin index yang bolong-bolong.
  _fullInventoryJSON () {
    return Array.from({ length: 36 }, (_, i) => this._simplifySlot(this.inventory[i]))
  }

  toStatusJSON () {
    return {
      id: this.id,
      config: {
        host: this.config.host,
        port: this.config.port,
        version: this.config.version,
        username: this.config.username,
        offline: this.config.offline
      },
      status: this.status,
      msaCode: this.msaCode,
      error: this.error,
      kickReason: this.kickReason,
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround,
      health: this.health,
      afk: this.afk,
      autoWalk: this.autoWalk,
      playersOnline: this.playersOnline,
      heldItemEmpty: isEmptyItem(this.inventory[this.selectedHotbarSlot]),
      selectedHotbarSlot: this.selectedHotbarSlot,
      inventory: this._fullInventoryJSON(),
      container: {
        open: this.container.open,
        windowType: this.container.windowType,
        position: this.container.position,
        slots: this.container.open ? this.container.slots.map(s => this._simplifySlot(s)) : []
      },
      chat: this.chat.slice(-50)
    }
  }

  connect () {
    const opts = {
      host: this.config.host,
      port: Number(this.config.port) || 19132,
      username: this.config.username || 'ISANC_Player',
      offline: !!this.config.offline,
      version: this.config.version || undefined,
      profilesFolder: path.join(__dirname, '..', 'data', 'auth', this.config.authProfile || this.config.username || 'default'),
      // Lewati ping awal (dipakai bedrock-protocol buat auto-deteksi versi server).
      // Ping ini SELALU pakai backend raknet-native secara hardcoded di
      // bedrock-protocol (lihat src/createClient.js), terlepas dari raknetBackend
      // yang kita pilih, dan pernah ketemu bug "cb is not a function" pas
      // unconnectedPong nyampe telat. Kalau kamu isi field "Versi" di form,
      // itu yang dipakai langsung tanpa perlu ping buat auto-detect.
      skipPing: true,
      onMsaCode: (data) => {
        // data: { user_code, verification_uri, message, expires_in, interval }
        this.status = 'awaiting_auth'
        this.msaCode = {
          user_code: data.user_code,
          verification_uri: data.verification_uri || 'https://microsoft.com/link',
          message: data.message || null,
          expires_in: data.expires_in || null
        }
      }
    }

    try {
      this.client = bedrock.createClient(opts)
    } catch (err) {
      this.status = 'error'
      this.error = err.message
      return
    }

    const client = this.client

    client.on('session', () => {
      this.msaCode = null
      this.status = 'authenticated'
    })

    client.on('join', () => {
      this.status = 'joined'
      this.pushChat({ system: true, message: 'Berhasil login, menunggu spawn...' })
    })

    client.on('spawn', () => {
      this.status = 'spawned'
      this._spawnedAt = Date.now()
      this.pushChat({ system: true, message: 'Bot sudah spawn di dunia. (Warm-up ~' + Math.round(SPAWN_GRACE_MS / 1000) + 'detik sebelum aksi aktif kayak lompat/pukul/taruh diizinkan.)' })
      this._startMoveLoop()
    })

    client.on('start_game', (packet) => {
      try {
        this.runtimeId = packet.runtime_entity_id
        if (packet.player_position) this.position = { ...packet.player_position }
        if (packet.rotation) {
          this.pitch = packet.rotation.x || 0
          this.yaw = packet.rotation.y || 0
        }
        this._lastSentPos = { ...this.position }

        // PENTING (fix gerak/lompat/sneak tidak berpengaruh):
        // `tick` di player_auth_input HARUS nyambung dengan tick dunia yang
        // sedang berjalan di server, bukan mulai dari 0. Server (apalagi yang
        // pakai anti-cheat/validasi rewind kayak server kamu) memvalidasi
        // packet pergerakan terhadap tick dunia saat ini; kalau tick yang kita
        // kirim jauh melenceng (misal kita mulai dari 0 sementara server sudah
        // jalan jutaan tick), packet pergerakan/lompat/sneak akan "didiemin"/
        // ditolak diam-diam oleh server meski packet-nya sendiri terkirim
        // sukses tanpa error. `block_action` (taruh/pecah block, walau
        // dikirim lewat packet yang sama) biasanya tidak divalidasi seketat
        // itu, makanya itu tetap jalan sementara gerak/lompat/sneak mati.
        // `current_tick` (li64) di start_game adalah tick dunia saat ini,
        // dipakai sebagai titik awal counter kita.
        if (packet.current_tick != null) {
          try {
            this._authTick = BigInt(packet.current_tick)
          } catch (_) {
            this._authTick = 0n
          }
        }
      } catch (_) { /* biarkan default kalau field beda versi */ }
    })

    // Ini paket SERVER -> CLIENT (koreksi posisi / teleport dari server, misal
    // habis lompat ke tempat lain atau anti-cheat mengoreksi posisi kita).
    //
    // BUG YANG DIPERBAIKI (penyebab koordinat nggak akurat / nggak realtime,
    // dan gerak/pukul kayak nggak berpengaruh): field `runtime_entity_id` di
    // packet_start_game itu tipe protodef `varint64`, yang di-decode jadi
    // BigInt (lihat node_modules/protodef/src/datatypes/varint.js -
    // readVarLong pakai `0n`/operasi BigInt). Tapi field `runtime_id` di
    // packet_move_player itu tipe `varint` biasa (Number biasa). Kode
    // sebelumnya bandingin `packet.runtime_id === this.runtimeId` - itu sama
    // dengan `Number === BigInt`, dan di JavaScript itu SELALU `false` walau
    // angkanya identik (mis. `5 === 5n` -> false). Akibatnya paket koreksi
    // posisi dari server buat player KITA SENDIRI nggak pernah kebaca -
    // selalu nyasar ke cabang "entity lain" di bawah. Makanya posisi yang
    // ditampilkan nyangkut di titik spawn awal (nggak realtime), dan karena
    // posisi ini juga dipakai buat ngitung target pukul/taruh block, semua
    // itu keitung dari lokasi yang salah lalu ditolak diam-diam sama server.
    // Fix-nya: samakan tipe sebelum dibandingkan pakai BigInt(...).
    client.on('move_player', (packet) => {
      const pktRuntimeId = BigInt(packet.runtime_id)
      if (this.runtimeId != null && pktRuntimeId === this.runtimeId) {
        this._reportServerCorrection(packet.position, packet.mode)
        this.position = { ...packet.position }
        this._lastSentPos = { ...this.position }
        this.pitch = packet.pitch
        this.yaw = packet.yaw
        if (typeof packet.on_ground === 'boolean') this._setOnGround(packet.on_ground)
        this._velY = 0 // server udah kasih posisi otoritatif, buang prediksi jatuh lokal
      } else {
        const ent = this.entities.get(pktRuntimeId)
        if (ent) ent.position = { ...packet.position }
      }
    })

    // Beberapa versi mengoreksi posisi lewat correct_player_move_prediction
    client.on('correct_player_move_prediction', (packet) => {
      try {
        if (packet.position) {
          this._reportServerCorrection(packet.position)
          this.position = { ...packet.position }
          this._lastSentPos = { ...this.position }
        }
        if (typeof packet.on_ground === 'boolean') this._setOnGround(packet.on_ground)
        this._velY = 0
      } catch (_) {}
    })

    client.on('add_player', (packet) => {
      this.entities.set(packet.runtime_id, {
        uniqueId: packet.unique_id, // ID BEDA dari runtime_id, dipakai remove_entity (lihat bawah)
        position: packet.position,
        name: packet.username,
        kind: 'player'
      })
      this.playersOnline = this.entities.size
    })

    client.on('add_entity', (packet) => {
      this.entities.set(packet.runtime_id, {
        uniqueId: packet.unique_id,
        position: packet.position,
        name: packet.identifier || 'mob',
        kind: 'mob'
      })
    })

    // BUG YANG DIPERBAIKI: packet_remove_entity cuma punya field
    // `entity_id_self`, yang menurut skema resmi itu EntityUniqueID (zigzag64),
    // BUKAN runtime_id yang dipakai sebagai key di Map `this.entities` (lihat
    // add_player/add_entity di atas - keduanya punya DUA id berbeda: unique_id
    // dan runtime_id). Kode sebelumnya `this.entities.delete(packet.entity_id_self)`
    // otomatis nggak pernah match key manapun, jadi entity yang udah pergi/despawn
    // nggak pernah kehapus dari daftar kita - lama-lama numpuk entity basi, dan
    // tombol "PUKUL" bisa milih target yang sebenarnya udah nggak ada/pindah,
    // yang otomatis ditolak server. Fix-nya: cari runtime_id yang uniqueId-nya
    // cocok, baru hapus itu.
    client.on('remove_entity', (packet) => {
      for (const [runtimeId, ent] of this.entities) {
        if (ent.uniqueId === packet.entity_id_self) {
          this.entities.delete(runtimeId)
          break
        }
      }
      this.playersOnline = this.entities.size
    })

    // BUG YANG DIPERBAIKI: update_attributes itu bisa dikirim buat ENTITY
    // MANAPUN yang keliatan sama bot (mob/pemain lain di sekitar), bukan cuma
    // buat diri sendiri. Field `runtime_entity_id` (varint64/BigInt) yang
    // nunjukin itu attribute milik siapa - kode sebelumnya nggak ngecek field
    // ini sama sekali, jadi HP yang ditampilkan di web bisa aja HP entity lain
    // yang lewat, bukan HP bot kita. Fix-nya: filter dulu sebelum dipakai.
    client.on('update_attributes', (packet) => {
      try {
        if (this.runtimeId != null && packet.runtime_entity_id === this.runtimeId) {
          const attrs = packet.attributes || []
          const health = attrs.find(a => a.name === 'minecraft:health')
          if (health) this.health = health.current
        }
      } catch (_) {}
    })

    // Tabel nama item (runtime_id -> "minecraft:xxx"), dikirim server sekali pas awal join.
    // Dipakai _simplifySlot() buat nampilin nama item beneran di tas/hotbar/chest, bukan cuma
    // angka network_id mentah yang nggak berarti apa-apa buat user.
    client.on('item_registry', (packet) => {
      try {
        for (const it of (packet.itemstates || [])) {
          this._itemNames.set(it.runtime_id, it.name)
        }
      } catch (_) {}
    })

    // Isi tas/hotbar - dipakai biar tombol "TARUH" tau beneran ada block di
    // tangan atau nggak, daripada asal kirim "tangan kosong" tiap kali (yang
    // pasti gagal, karena Minecraft nggak bisa naruh block tanpa pegang block).
    //
    // window_id 'inventory' = tas utama kita. Kalau bukan itu TAPI ada chest/container
    // yang lagi kebuka (this.container.open) dan window_id-nya cocok sama punya container
    // itu, berarti ini isi si CHEST, bukan tas kita - taruh di this.container.slots biar
    // nggak ketimpa/ketimpa-in sama tas sendiri (lihat openContainer()/container_open di bawah).
    client.on('inventory_content', (packet) => {
      try {
        if (packet.window_id === 'inventory') {
          this.inventory = packet.input || []
        } else if (this.container.open && packet.window_id === this.container.windowId) {
          this.container.slots = packet.input || []
        }
      } catch (_) {}
    })
    client.on('inventory_slot', (packet) => {
      try {
        if (packet.window_id === 'inventory') {
          this.inventory[packet.slot] = packet.item
        } else if (this.container.open && packet.window_id === this.container.windowId) {
          this.container.slots[packet.slot] = packet.item
        }
      } catch (_) {}
    })
    client.on('player_hotbar', (packet) => {
      try {
        if (packet.window_id === 'inventory' && typeof packet.selected_slot === 'number') {
          this.selectedHotbarSlot = packet.selected_slot
        }
      } catch (_) {}
    })

    // Server ngasih tau chest/container yang kita coba buka (lewat openContainer() di
    // bawah) beneran kebuka. window_id di sini yang harus kita cocokin di inventory_content/
    // inventory_slot di atas biar tau paket mana isi chest vs isi tas kita sendiri.
    client.on('container_open', (packet) => {
      try {
        clearTimeout(this._pendingContainerOpenTimeout)
        this._pendingContainerOpen = null
        this.container = {
          open: true,
          windowId: packet.window_id,
          windowType: packet.window_type,
          position: packet.coordinates || null,
          slots: []
        }
        this.pushChat({ system: true, message: 'Chest/container kebuka (' + packet.window_type + ').' })
      } catch (_) {}
    })

    // Bisa datang dari SERVER (dipaksa nutup, mis. kejauhan/block-nya ilang) - bukan cuma
    // balasan dari closeContainer() kita sendiri, jadi tetap harus didengerin di sini biar
    // state di web nggak "nyangkut" ngerasa masih kebuka padahal udah ketutup beneran.
    client.on('container_close', (packet) => {
      try {
        if (this.container.open && (packet.window_id == null || packet.window_id === this.container.windowId)) {
          this.container = { open: false, windowId: null, windowType: null, position: null, slots: [] }
        }
      } catch (_) {}
    })

    // Balasan dari item_stack_request (dikirim clickContainerSlot()) - satu-satunya cara
    // kita tau beneran server nerima "klik slot chest" itu atau nolak (misal stack_id nggak
    // cocok / server nggak pakai sistem ini buat menu custom-nya). ok = server SETUJU
    // aksinya (walau belum tentu artinya, misal, "masuk ke server ekonomi" beneran kejadian,
    // itu tergantung logic server-nya), error = ditolak/di-revert.
    client.on('item_stack_response', (packet) => {
      try {
        for (const resp of (packet.responses || [])) {
          const pending = this._pendingStackRequests.get(resp.request_id)
          if (!pending) continue
          clearTimeout(pending.timeout)
          this._pendingStackRequests.delete(resp.request_id)
          this.pushChat({
            system: true,
            message: resp.status === 'ok'
              ? (pending.desc + ' - diterima server.')
              : (pending.desc + ' - DITOLAK server (status: ' + resp.status + ').')
          })
        }
      } catch (_) {}
    })

    // Bukti nyata dari server apakah "PUKUL" (mecah block) / "TARUH" beneran
    // kepakai atau ditolak diam-diam. update_block dikirim server tiap kali
    // ada block yang BENERAN berubah di dunia - kalau posisinya cocok sama
    // target pukul/taruh terakhir kita dalam beberapa detik, berarti sukses.
    // Kalau timeout duluan tanpa update_block yang cocok, kasih tau jujur
    // kemungkinan ditolak, daripada bot diem-diem aja tanpa kepastian.
    client.on('update_block', (packet) => {
      const pending = this._pendingBlockAction
      if (!pending || !packet.position) return
      const p = packet.position
      if (p.x === pending.pos.x && p.y === pending.pos.y && p.z === pending.pos.z) {
        clearTimeout(this._pendingBlockTimeout)
        // CATATAN: ini cuma ngecek POSISI-nya cocok, BUKAN mastiin block-nya
        // beneran jadi kosong (buat pecah) atau beneran jadi block yang
        // ditaruh (buat taruh). Bedrock kadang ngirim update_block sebagai
        // "gema"/re-sync tanpa perubahan nyata (mis. baru mulai retak/crack
        // overlay pas mecah, bukan beneran ancur). block_runtime_id di bawah
        // ini nunjukin ID block hasil akhirnya - kalau abis "berhasil dipecah"
        // block_runtime_id-nya BUKAN 0 (bukan udara), berarti ini kemungkinan
        // besar cuma gema, bukan beneran ancur. Ini bukti buat didiagnosa,
        // bukan garansi 100% berhasil.
        this.pushChat({
          system: true,
          message: (pending.kind === 'pecah' ? 'Block berhasil dipecah' : 'Block berhasil ditaruh') +
            ' (dikonfirmasi server lewat update_block, block_runtime_id baru: ' + packet.block_runtime_id + ').'
        })
        this._pendingBlockAction = null
      }
    })

    client.on('text', (packet) => {
      this.pushChat({
        system: false,
        source: packet.source_name || 'server',
        message: packet.message
      })
    })

    client.on('disconnect', (packet) => {
      this.status = 'disconnected'
      this.kickReason = packet && packet.message ? packet.message : null
      this._stopMoveLoop()
      this._stopAfk()
    })

    client.on('close', () => {
      if (this.status !== 'kicked') this.status = 'disconnected'
      this._stopMoveLoop()
      this._stopAfk()
    })

    client.on('kick', (reason) => {
      this.status = 'kicked'
      this.kickReason = typeof reason === 'string' ? reason : JSON.stringify(reason)
      this._stopMoveLoop()
      this._stopAfk()
    })

    client.on('error', (err) => {
      this.status = 'error'
      this.error = err && err.message ? err.message : String(err)
    })

    // Wajib buat Bedrock modern: server berkala ngirim network_stack_latency
    // sebagai "detak jantung" koneksi. Kalau nggak dibalas, server nganggep
    // koneksi mati dan nge-drop bot dengan alasan `Timed out!` walau
    // player_auth_input tetap jalan normal.
    //
    // FIX: packet_network_stack_latency itu `bound: both` (skema resmi,
    // lihat minecraft-data proto.yml) - artinya balasannya PAKAI NAMA PACKET
    // YANG SAMA (bukan packet terpisah "network_stack_latency_response",
    // yang nggak ada di protokol dan sebelumnya bikin balasan ini kemungkinan
    // gagal serialize/di-drop diam-diam). Field-nya cuma dua: `timestamp`
    // (dikembalikan persis seperti yang server kirim) dan `needs_response`
    // (di-set false karena ini balasan kita, bukan permintaan balasan baru).
    client.on('network_stack_latency', (packet) => {
      // DEBUG SEMENTARA - hapus lagi setelah ketemu penyebabnya
      console.log('[DEBUG network_stack_latency] diterima:', packet)
      try {
        if (packet.needs_response) {
          client.queue('network_stack_latency', {
            timestamp: packet.timestamp,
            needs_response: false
          })
          console.log('[DEBUG network_stack_latency] dibalas dengan timestamp:', packet.timestamp)
        }
      } catch (err) {
        this.pushChat({ system: true, message: 'Gagal balas latency: ' + err.message })
      }
    })

    client.on('disconnect', (packet) => {
      console.log('[DEBUG disconnect]', packet)
    })
    client.on('kick', (packet) => {
      console.log('[DEBUG kick]', packet)
    })
  }

  // --------------------------------------------------------------------
  // Loop utama: kirim `player_auth_input` SETIAP TICK. Ini satu-satunya
  // packet yang perlu buat jalan/lompat/sneak/mecah-block di versi modern.
  // --------------------------------------------------------------------
  // BUG YANG DIPERBAIKI (tambahan dari catatan debugging anti-cheat): pakai
  // setInterval(TICK_MS) bikin gap antar packet player_auth_input SELALU
  // persis 50.000ms - klien Minecraft asli nggak pernah sepresisi itu (ada
  // jitter alami dari render loop/OS scheduler). Beberapa anti-cheat curiga
  // ke traffic yang jitter-nya nol sebagai indikasi bot/non-human. Fix-nya:
  // jadwalkan ulang tiap tick pakai setTimeout dengan variasi acak kecil
  // (+/- TICK_JITTER_MS), rata-rata tetap 50ms jadi nggak melenceng dari
  // ritme 20Hz yang divalidasi server.
  _startMoveLoop () {
    if (this._moveTimer) return
    const loop = () => {
      this._tick()
      const jitter = Math.floor(Math.random() * (TICK_JITTER_MS * 2 + 1)) - TICK_JITTER_MS
      this._moveTimer = setTimeout(loop, TICK_MS + jitter)
    }
    this._moveTimer = setTimeout(loop, TICK_MS)
  }

  _stopMoveLoop () {
    if (this._moveTimer) {
      clearTimeout(this._moveTimer)
      this._moveTimer = null
    }
  }

  _tick () {
    if (this.status !== 'spawned' || !this.client) return

    // PENTING: `input_data` itu tipe "bitflags" di protodef. Formatnya WAJIB
    // object {nama_flag: true/false}, BUKAN array nama flag. Sebelumnya di
    // sini pakai array (`flags.push('up')` dst) — itu sebabnya packet
    // ke-kirim TANPA error (jadi kelihatan "diam-diam gagal"), tapi semua
    // flag selalu kebaca 0 di sisi write, jadi server nggak pernah tahu kita
    // mau jalan/lompat/sneak. (lihat node-protodef src/datatypes/compiler-utils.js
    // fungsi Write.bitflags: `if (value[key]) val |= flags[key]` — kalau value
    // sebuah array, value['up'] selalu undefined).
    const flags = {}
    const { forward, back, left, right, sneak } = this.moveState

    // Hitung arah gerak lokal (relatif hadap) buat move_vector, dan pindahkan
    // posisi yang KITA catat sendiri (prediksi lokal buat tampilan UI saja -
    // posisi asli tetap otoritas server, dikoreksi lewat event move_player).
    let localX = 0 // strafe kiri(-)/kanan(+)
    let localZ = 0 // maju(+)/mundur(-)

    if (this.autoWalk) {
      // ---------------- OTOPILOT KE KOORDINAT ----------------
      const dx = this.autoWalk.x - this.position.x
      const dz = this.autoWalk.z - this.position.z
      const flatDist = Math.hypot(dx, dz)
      const ARRIVE_DIST = 0.4

      if (flatDist <= ARRIVE_DIST) {
        this.pushChat({ system: true, message: 'Otopilot: sudah sampai di tujuan (' + this.autoWalk.x + ', ' + this.autoWalk.z + ').' })
        this.autoWalk = null
      } else {
        // Hadapkan bot ke arah tujuan (konversi vektor dx/dz -> yaw, kebalikan
        // dari forwardVector() di atas: yaw 0 = +Z).
        const targetYawRad = Math.atan2(-dx, dz)
        this.yaw = (((targetYawRad * 180) / Math.PI) % 360 + 360) % 360
        localZ = 1 // selalu "maju" karena yaw sudah kita paksa menghadap tujuan
        flags.up = true

        // Deteksi macet/nyangkut (tembok, pagar, beda ketinggian) -> coba lompat
        // otomatis tiap ~0.6 detik kalau posisi nggak banyak berubah.
        this._autoWalkStuckTicks++
        if (this._autoWalkStuckTicks >= 12) {
          const moved = this._autoWalkStuckPos ? dist3(this.position, this._autoWalkStuckPos) : 999
          if (moved < 0.15) this.jump()
          this._autoWalkStuckPos = { ...this.position }
          this._autoWalkStuckTicks = 0
        }
      }
    } else if (forward || back || left || right) {
      // ---------------- GERAK MANUAL (tombol D-Pad) ----------------
      if (forward) { localZ += 1; flags.up = true }
      if (back) { localZ -= 1; flags.down = true }
      if (right) { localX += 1; flags.right = true }
      if (left) { localX -= 1; flags.left = true }
    }

    if (localX !== 0 || localZ !== 0) {
      const mag = Math.hypot(localX, localZ) || 1
      const nx = localX / mag
      const nz = localZ / mag
      const fwd = forwardVector(this.yaw)
      const right90 = forwardVector(this.yaw + 90)
      this.position.x += (fwd.x * nz + right90.x * nx) * MOVE_SPEED
      this.position.z += (fwd.z * nz + right90.z * nx) * MOVE_SPEED
    }

    // BUG YANG DIPERBAIKI (kemungkinan penyebab sneak nggak berpengaruh):
    // sebelumnya cuma kirim flag "sneaking"/"sneak_down" tiap tick selama
    // ditahan. Tapi persis kayak jump butuh "start_jumping" di tick
    // pertama (lihat komentar di header file ini soal bug itu), skema resmi
    // InputFlag JUGA punya flag transisi khusus "start_sneaking"/
    // "stop_sneaking" - beberapa implementasi server pakai flag transisi ini
    // buat men-toggle pose/hitbox sneak, bukan cuma flag "sneaking" yang terus
    // menerus. Sebelumnya nggak pernah dikirim sama sekali.
    if (sneak) {
      flags.sneaking = true
      flags.sneak_down = true
      if (!this._prevSneak) flags.start_sneaking = true
    } else if (this._prevSneak) {
      flags.stop_sneaking = true
    }
    this._prevSneak = sneak

    if (this._jumpTicks > 0) {
      flags.jumping = true
      flags.jump_down = true
      if (this._jumpTicks === 3) {
        flags.start_jumping = true
        this._velY = JUMP_VELOCITY
        this._setOnGround(false)
      }
      this._jumpTicks--
    }

    // Fallback lokal "dianggap sudah mendarat": kalau server nggak/jarang
    // kirim koreksi on_ground balik (banyak server permisif nggak selalu
    // ngirim ini), jump() bisa terkunci nggak bisa lompat lagi selamanya
    // kalau cuma ngandelin correction packet. Beda dari versi sebelumnya:
    // timer ini jalan buat SEMUA penyebab airborne (bukan cuma pas kita
    // sendiri yang mulai lompat - lihat _setOnGround), jadi nggak bakal
    // macet permanen walau onGround jadi false dari koreksi server lain.
    // Koreksi asli dari server (kalau ada) tetap menang duluan kapan pun
    // datang - ini cuma jaring pengaman.
    if (!this.onGround && this._airborneSince && Date.now() - this._airborneSince > JUMP_AIR_MS) {
      this._setOnGround(true)
      this._velY = 0
    }

    // Aproksimasi gravitasi: kalau server bilang kita lagi nggak nginjek
    // tanah (this.onGround dari koreksi move_player/correct_player_move_prediction,
    // atau baru lompat di atas), tarik posisi Y turun tiap tick niru physics
    // vanilla. Ini CUMA prediksi lokal biar nggak keliatan "melayang diem" ke
    // server - posisi sebenarnya tetap otoritas server (dikoreksi balik lewat
    // event yang sama tiap kali melenceng, lihat penjelasan di atas).
    if (!this.onGround) {
      this.position.y += this._velY
      this._velY = (this._velY - GRAVITY) * AIR_DRAG
    }

    let blockAction
    if (this._breaking && this._breakPos) {
      flags.block_action = true
      blockAction = [{
        action: this._breakFirstTick ? 'start_break' : 'continue_break',
        position: this._breakPos,
        face: this._breakFace
      }]
      this._breakFirstTick = false
    }

    // Taruh block: one-shot, nempel di field `transaction` player_auth_input
    // tick ini doang, langsung dibersihin abis kepakai (lihat placeBlock()).
    let pendingTransaction
    if (this._pendingPlace) {
      pendingTransaction = {
        legacy: { legacy_request_id: 0 },
        actions: [],
        data: {
          action_type: 'click_block',
          trigger_type: 'player_input',
          block_position: this._pendingPlace.targetPos,
          face: 1,
          hotbar_slot: this._pendingPlace.hotbarSlot,
          held_item: this._pendingPlace.heldItem,
          player_pos: this.position,
          click_pos: { x: 0.5, y: 1, z: 0.5 },
          block_runtime_id: 0,
          client_prediction: 'success',
          client_cooldown_state: 'off'
        }
      }
      this._pendingPlace = null
    }

    const delta = {
      x: this.position.x - this._lastSentPos.x,
      y: this.position.y - this._lastSentPos.y,
      z: this.position.z - this._lastSentPos.z
    }
    this._lastSentPos = { ...this.position }
    this._authTick += 1n

    const packet = {
      pitch: this.pitch,
      yaw: this.yaw,
      position: this.position,
      move_vector: { x: localX, z: localZ },
      head_yaw: this.yaw,
      input_data: flags,
      input_mode: 'mouse',
      play_mode: 'normal',
      interaction_model: 'crosshair',
      interact_rotation: { x: this.pitch, z: this.yaw },
      tick: this._authTick,
      delta,
      analogue_move_vector: { x: localX, z: localZ },
      camera_orientation: { x: 0, y: 0, z: 0 },
      raw_move_vector: { x: localX, z: localZ }
    }
    if (blockAction) packet.block_action = blockAction
    if (pendingTransaction) packet.transaction = pendingTransaction

    try {
      this.client.queue('player_auth_input', packet)
    } catch (err) {
      // Jangan didiamkan total kayak sebelumnya - tampilkan sesekali (di-throttle)
      // biar kelihatan di tab Chat kalau ada error serialisasi packet.
      const now = Date.now()
      if (!this._lastTickErrorAt || now - this._lastTickErrorAt > 5000) {
        this._lastTickErrorAt = now
        this.pushChat({ system: true, message: 'player_auth_input gagal (cek versi protokol): ' + err.message })
      }
    }
  }

  setMove (direction, active) {
    if (!(direction in this.moveState)) return
    if (active && this.autoWalk) this.cancelGoto() // tombol manual = ambil alih kontrol
    this.moveState[direction] = !!active
  }

  turn (deltaYaw, deltaPitch) {
    if (typeof deltaYaw === 'number') this.yaw = ((this.yaw + deltaYaw) % 360 + 360) % 360
    if (typeof deltaPitch === 'number') this.pitch = clamp(this.pitch + deltaPitch, -90, 90)
  }

  jump () {
    if (!this.client || this.status !== 'spawned') return

    // BUG YANG DIPERBAIKI (ini penyebab "spam lompat jadi fly"): sebelumnya
    // fungsi ini SELALU mengizinkan lompat lagi kapan pun tombol ditekan,
    // nggak peduli bot lagi di udara atau nggak. Di Minecraft asli kamu cuma
    // bisa lompat kalau lagi nginjek tanah - kalau server tujuan nggak
    // validasi ini (banyak server tanpa anti-cheat ketat nggak ngecek), tiap
    // kali kita kirim "start_jumping" server nambahin dorongan ke atas lagi
    // sebelum sempat jatuh penuh - di-spam terus ya numpuk jadi terbang
    // beneran (server-side), bukan sekedar bug tampilan.
    if (!this._warmedUp()) { this._warmupChat('lompat'); return }
    if (!this.onGround) return
    this._jumpTicks = 3
  }

  toggleSneak (active) {
    this.moveState.sneak = !!active
  }

  // ---------------- Otopilot: jalan sendiri ke koordinat X (Y) Z ----------------
  // Catatan penting: ini BUKAN pathfinding asli - bot cuma jalan lurus menghadap
  // titik tujuan dan lompat otomatis kalau kedeteksi macet. Jadi paling work di
  // area terbuka/rata; kalau ada jurang, air, atau rintangan rumit, bisa nyangkut.
  // Y sengaja diabaikan buat pergerakan (nggak ada terbang/climb paksa), cuma
  // dipakai dari sisi tampilan.
  gotoCoordinate (x, y, z) {
    if (!this.client || this.status !== 'spawned') return
    const target = { x: Number(x), z: Number(z) }
    target.y = (y === undefined || y === null || y === '') ? null : Number(y)
    if (Number.isNaN(target.x) || Number.isNaN(target.z) || (target.y !== null && Number.isNaN(target.y))) {
      this.pushChat({ system: true, message: 'Koordinat tidak valid.' })
      return
    }
    this.autoWalk = target
    this._autoWalkStuckPos = { ...this.position }
    this._autoWalkStuckTicks = 0
    this.pushChat({
      system: true,
      message: 'Otopilot: jalan ke (' + target.x + ', ' + (target.y === null ? '~' : target.y) + ', ' + target.z + ')...'
    })
  }

  cancelGoto () {
    if (this.autoWalk) {
      this.autoWalk = null
      this.pushChat({ system: true, message: 'Otopilot dibatalkan.' })
    }
  }

  chatSend (message) {
    if (!this.client || !message) return
    try {
      // FIX: skema packet_text terbaru punya field `category` (u8, ditulis
      // SEBELUM `type`) dan `has_filtered_message` (bool, menentukan apakah
      // `filtered_message` ikut ditulis). Versi sebelumnya tidak mengisi
      // `category` sama sekali dan langsung menulis `filtered_message` tanpa
      // `has_filtered_message` - karena `category` itu field wajib bertipe
      // angka yang dibaca duluan, kalau nilainya undefined, penulisan byte
      // packet jadi kacau dari situ dan seluruh field sesudahnya (source_name,
      // message, xuid, dst) ikut salah baca di sisi server. Itu sebabnya chat
      // yang sampai ke server bisa keliatan kacau/salah, meskipun log lokal
      // ("Kamu: ...") kelihatan normal karena itu cuma echo yang di-push
      // manual, bukan konfirmasi dari server.
      this.client.queue('text', {
        type: 'chat',
        category: 'authored',
        needs_translation: false,
        source_name: this.config.username || 'ISANC',
        xuid: '',
        platform_chat_id: '',
        has_filtered_message: false,
        message
      })
      this.pushChat({ system: false, source: this.config.username, message, self: true })
    } catch (err) {
      this.pushChat({ system: true, message: 'Gagal kirim chat: ' + err.message })
    }
  }

  _findNearestEntity () {
    let nearest = null
    let nearestDist = Infinity
    for (const [id, ent] of this.entities) {
      const d = dist3(this.position, ent.position)
      if (d < nearestDist && d <= ATTACK_RANGE) {
        nearest = { id, ...ent }
        nearestDist = d
      }
    }
    return nearest
  }

  // Tombol "PUKUL": kalau ada entity/mob dalam jangkauan -> serang langsung
  // (inventory_transaction / item_use_on_entity). Kalau tidak ada -> mulai
  // "menahan klik kiri" ke block di depan selama BREAK_BURST_MS lewat
  // block_action di player_auth_input (server yang tentukan kapan block
  // itu benar-benar pecah, tergantung hardness block & tool).
  // Pasang "pengintai" konfirmasi dari server buat satu aksi pecah/taruh
  // block (lihat listener 'update_block' di connect()). Kalau nggak ada
  // update_block yang cocok sebelum timeout, kasih tau jujur kemungkinan
  // ditolak - daripada bot cuma diam tanpa kepastian ke user.
  _watchBlockAction (kind, pos, timeoutMs) {
    clearTimeout(this._pendingBlockTimeout)
    const pending = { kind, pos, at: Date.now() }
    this._pendingBlockAction = pending
    this._pendingBlockTimeout = setTimeout(() => {
      if (this._pendingBlockAction === pending) {
        this.pushChat({
          system: true,
          message: 'Belum ada konfirmasi dari server dalam ' + Math.round(timeoutMs / 1000) +
            ' detik buat ' + kind + ' block - kemungkinan ditolak (anti-cheat, block kelewat keras/jauh, atau memang gagal).'
        })
        this._pendingBlockAction = null
      }
    }, timeoutMs)
  }

  attack () {
    if (!this.client || this.status !== 'spawned') return
    if (!this._warmedUp()) { this._warmupChat('pukul'); return }

    try {
      this.client.queue('animate', {
        action_id: 'swing_arm',
        runtime_entity_id: this.runtimeId,
        data: 0,
        has_swing_source: false
      })
    } catch (_) {}

    const target = this._findNearestEntity()
    if (target) {
      try {
        this.client.queue('inventory_transaction', {
          transaction: {
            legacy: { legacy_request_id: 0 },
            transaction_type: 'item_use_on_entity',
            actions: [],
            transaction_data: {
              entity_runtime_id: target.id,
              action_type: 'attack',
              hotbar_slot: 0,
              held_item: EMPTY_ITEM_V4,
              player_pos: this.position,
              click_pos: { x: 0, y: 0, z: 0 }
            }
          }
        })
        this.pushChat({ system: true, message: 'Menyerang ' + (target.name || 'entity') })
      } catch (err) {
        this.pushChat({ system: true, message: 'Attack gagal (cek versi protokol): ' + err.message })
      }
      return
    }

    // Tidak ada entity -> mulai mecah block di depan
    if (this._breaking) return // sudah mecah, jangan restart tiap klik
    const fwd = forwardVector(this.yaw)
    // BUG YANG DIPERBAIKI: floor(y - 0.5) cuma nunjuk ke block tanah yang bener
    // KALAU posisi Y bot kebetulan bilangan bulat. Begitu ada pecahan (yang
    // normal banget pas jalan/lompat/medan gak rata), floor(y - 0.5) bisa
    // nunjuk ke level kaki bot sendiri (biasanya udara) bukan block tanah di
    // bawahnya - server diem aja karena gak ada block valid buat "diklik" di
    // situ (lihat catatan block_runtime_id di types.yml protokol: dipakai
    // server buat cek sinkronisasi client/server, ditolak diam-diam kalau
    // mismatch). floor(y) - 1 = block tanah tepat di bawah kaki, konsisten
    // berapapun pecahan Y-nya.
    this._breakPos = {
      x: Math.floor(this.position.x + fwd.x),
      y: Math.floor(this.position.y) - 1,
      z: Math.floor(this.position.z + fwd.z)
    }
    this._breakFace = 1
    this._breaking = true
    this._breakFirstTick = true
    this.pushChat({ system: true, message: 'Mulai mecah block di depan...' })
    this._watchBlockAction('pecah', this._breakPos, BREAK_BURST_MS + ACTION_CONFIRM_TIMEOUT_MS)

    clearTimeout(this._breakTimeout)
    this._breakTimeout = setTimeout(() => {
      this._breaking = false
      this._breakPos = null
    }, BREAK_BURST_MS)
  }

  placeBlock () {
    if (!this.client || this.status !== 'spawned') return
    if (!this._warmedUp()) { this._warmupChat('taruh block'); return }

    // BUG YANG DIPERBAIKI: sebelumnya held_item SELALU dikirim "tangan kosong"
    // (EMPTY_ITEM) apapun kondisinya - jadi tombol TARUH nggak akan PERNAH
    // berhasil naruh block sama sekali, wajar aja gagal, karena Minecraft
    // memang nggak bisa naruh block kalau tangan kosong (itu aturan game,
    // bukan bug protokol). Sekarang kita cek isi slot hotbar pertama beneran
    // (dilacak dari inventory_content/inventory_slot) sebelum kirim; kalau
    // kosong, kasih tau jujur daripada diam-diam gagal lagi.
    const heldSlotItem = this.inventory[this.selectedHotbarSlot]
    if (isEmptyItem(heldSlotItem)) {
      this.pushChat({
        system: true,
        message: 'Nggak bisa taruh block: slot hotbar pertama kosong (tangan kosong). Isi block dulu di slot 1 lewat game/inventory.'
      })
      return
    }

    const fwd = forwardVector(this.yaw)
    // Sama kayak fix di _breakPos: floor(y) - 1 (block tanah tepat di bawah
    // kaki) lebih konsisten daripada floor(y - 0.5), yang gampang nunjuk ke
    // udara di level kaki bot sendiri kalau Y ada pecahannya.
    const targetPos = {
      x: Math.floor(this.position.x + fwd.x),
      y: Math.floor(this.position.y) - 1,
      z: Math.floor(this.position.z + fwd.z)
    }
    try {
      // BUG YANG DIPERBAIKI: sebelumnya dikirim sebagai paket `inventory_transaction`
      // BERDIRI SENDIRI (gak nyambung tick dunia). Server anti-cheat ketat kemungkinan
      // besar ngabaikan diam-diam paket kayak gini buat aksi yang berdampak nyata ke
      // dunia (beda dari click_air/pakai-item yang gak butuh validasi dunia, makanya
      // itu tetep jalan). Sekarang ditempelin ke field `transaction` di
      // player_auth_input tick berikutnya - sama persis mekanismenya kayak
      // block_action (PUKUL) yang udah kebukti dapet balesan dari server. Lihat _tick().
      this._pendingPlace = { targetPos, hotbarSlot: this.selectedHotbarSlot, heldItem: toTransactionItem(heldSlotItem) }
      this.pushChat({
        system: true,
        message: 'Coba taruh block di (' + targetPos.x + ', ' + targetPos.y + ', ' + targetPos.z +
          '). Posisi bot sekarang: (' + this.position.x.toFixed(2) + ', ' + this.position.y.toFixed(2) + ', ' + this.position.z.toFixed(2) + ').'
      })
      this._watchBlockAction('taruh', targetPos, ACTION_CONFIRM_TIMEOUT_MS)
      // DEBUG SEMENTARA: nyatet SEMUA nama paket yang dateng dari server 5 detik ke
      // depan, biar ketauan reaksi ASLI server-nya (bukan tebak-tebak protokol lagi).
      // Aman dihapus abis kelar debugging.
      const seen = {}
      const onAnyPacket = (des) => {
        const name = des && des.data && des.data.name
        if (!name) return
        seen[name] = (seen[name] || 0) + 1
      }
      this.client.on('packet', onAnyPacket)
      setTimeout(() => {
        this.client.removeListener('packet', onAnyPacket)
        const summary = Object.entries(seen).map(([k, v]) => k + ' x' + v).join(', ') || '(gak ada paket apa-apa dari server sama sekali)'
        this.pushChat({ system: true, message: '[DEBUG] Paket dari server 5 detik abis taruh: ' + summary })
      }, 5000)
    } catch (err) {
      this.pushChat({ system: true, message: 'Place block gagal (cek versi protokol): ' + err.message })
    }
  }

  // Tombol slot hotbar 1-9 di UI: pindahin slot yang lagi "dipegang" bot. Ini SATU-SATUNYA
  // cara client memberitahu server slot mana yang aktif (server_authoritative_inventory
  // nggak mengubah ini - player_hotbar tetap dipakai buat pilih slot walau nggak lagi
  // dipakai buat "link" slot ke tas seperti versi lama, lihat komentar di proto.yml).
  // Di-update optimis di sisi kita juga, karena server nggak selalu ngirim balik
  // player_hotbar buat konfirmasi kalau perubahannya sesuai ekspektasi.
  selectHotbarSlot (slot) {
    if (!this.client || this.status !== 'spawned') return
    const s = Number(slot)
    if (!Number.isInteger(s) || s < 0 || s > 8) {
      this.pushChat({ system: true, message: 'Slot hotbar harus angka 0-8 (tampilan UI 1-9).' })
      return
    }
    try {
      this.client.queue('player_hotbar', {
        selected_slot: s,
        window_id: 'inventory',
        select_slot: true
      })
      this.selectedHotbarSlot = s
      this.pushChat({ system: true, message: 'Pindah ke slot hotbar ' + (s + 1) + '.' })
    } catch (err) {
      this.pushChat({ system: true, message: 'Gagal pindah slot hotbar: ' + err.message })
    }
  }

  // Tombol "Buka Chest": kirim interaksi klik-kanan ke block di koordinat yang dikasih (atau
  // block di depan bot kalau x/y/z nggak diisi) - PERSIS mekanisme yang sama kayak TARUH
  // block (inventory_transaction/item_use/click_block), bedanya di sini kita nggak peduli
  // tangan kosong atau enggak: buka chest jalan terus walau tangan kosong, servernya yang
  // nentuin block di posisi itu chest beneran atau bukan. Konfirmasi suksesnya lewat event
  // 'container_open' dari server (lihat listener di connect()), BUKAN langsung dari sini,
  // karena kita nggak bisa mastiin block-nya chest sebelum server bilang begitu.
  openContainer (x, y, z) {
    if (!this.client || this.status !== 'spawned') return
    if (!this._warmedUp()) { this._warmupChat('buka chest'); return }
    if (this.container.open) {
      this.pushChat({ system: true, message: 'Sudah ada chest yang kebuka - tutup dulu sebelum buka yang lain.' })
      return
    }

    let targetPos
    if (x !== undefined && x !== null && z !== undefined && z !== null) {
      targetPos = { x: Math.floor(x), y: Math.floor(y != null ? y : (this.position.y - 0.5)), z: Math.floor(z) }
    } else {
      const fwd = forwardVector(this.yaw)
      targetPos = {
        x: Math.floor(this.position.x + fwd.x),
        y: Math.floor(this.position.y - 0.5),
        z: Math.floor(this.position.z + fwd.z)
      }
    }

    const heldSlotItem = this.inventory[this.selectedHotbarSlot]
    try {
      this.client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          transaction_type: 'item_use',
          actions: [],
          transaction_data: {
            action_type: 'click_block',
            trigger_type: 'player_input',
            block_position: targetPos,
            face: 1,
            hotbar_slot: this.selectedHotbarSlot,
            held_item: toTransactionItem(heldSlotItem),
            player_pos: this.position,
            click_pos: { x: 0.5, y: 0.5, z: 0.5 },
            block_runtime_id: 0,
            client_prediction: 'failure', // kita nggak tau ini bakal "berhasil naruh" - biarin server yang mutusin sepenuhnya
            client_cooldown_state: 'off'
          }
        }
      })
      this.pushChat({ system: true, message: 'Coba buka chest di (' + targetPos.x + ', ' + targetPos.y + ', ' + targetPos.z + ')...' })

      clearTimeout(this._pendingContainerOpenTimeout)
      const pending = { pos: targetPos, at: Date.now() }
      this._pendingContainerOpen = pending
      this._pendingContainerOpenTimeout = setTimeout(() => {
        if (this._pendingContainerOpen === pending) {
          this.pushChat({
            system: true,
            message: 'Belum ada balasan container_open dari server - kemungkinan bukan block chest, kejauhan, atau koordinatnya salah.'
          })
          this._pendingContainerOpen = null
        }
      }, ACTION_CONFIRM_TIMEOUT_MS)
    } catch (err) {
      this.pushChat({ system: true, message: 'Buka chest gagal (cek versi protokol): ' + err.message })
    }
  }

  // Tombol "Tutup Chest": kasih tau server kita nutup container yang sekarang kebuka.
  // window_id/window_type WAJIB sama persis kayak yang dikasih server di container_open,
  // kalau nggak paket ini bisa diabaikan/dianggap invalid. State lokal langsung direset
  // optimis (nggak nunggu balasan) - toh worst case server kirim container_close lagi dan
  // listener di connect() cuma no-op karena container.open sudah false.
  closeContainer () {
    if (!this.client) return
    if (!this.container.open) return
    try {
      this.client.queue('container_close', {
        window_id: this.container.windowId,
        window_type: this.container.windowType || 'container',
        server: false
      })
    } catch (err) {
      this.pushChat({ system: true, message: 'Gagal kirim tutup chest: ' + err.message })
    }
    this.container = { open: false, windowId: null, windowType: null, position: null, slots: [] }
    this.pushChat({ system: true, message: 'Chest ditutup.' })
  }

  // Tombol "Klik Kanan": pakai item yang lagi dipegang TANPA target block (action_type
  // click_air, bukan click_block kayak TARUH). Ini yang beneran dipakai game buat item yang
  // punya "on use" langsung pas diklik kanan ke udara/ke mana aja - contohnya compass menu
  // server, makanan yang dimakan, busur yang ditarik, dll. Tombol TARUH (click_block) CUMA
  // buat naruh block ke posisi spesifik dan nggak akan pernah memicu menu semacam itu,
  // makanya sebelumnya nggak ada efeknya buat compass.
  useItem () {
    if (!this.client || this.status !== 'spawned') return
    if (!this._warmedUp()) { this._warmupChat('klik kanan / pakai item'); return }

    const heldSlotItem = this.inventory[this.selectedHotbarSlot]
    if (isEmptyItem(heldSlotItem)) {
      this.pushChat({ system: true, message: 'Tangan kosong - nggak ada item di slot hotbar aktif buat diklik kanan.' })
      return
    }

    const roundedPos = {
      x: Math.floor(this.position.x),
      y: Math.floor(this.position.y),
      z: Math.floor(this.position.z)
    }
    try {
      this.client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          transaction_type: 'item_use',
          actions: [],
          transaction_data: {
            action_type: 'click_air',
            trigger_type: 'player_input',
            block_position: roundedPos, // nggak dipakai server buat click_air (lihat catatan TransactionUseItem.block_position), diisi posisi bot sekedar nilai valid
            face: 0,
            hotbar_slot: this.selectedHotbarSlot,
            held_item: toTransactionItem(heldSlotItem),
            player_pos: this.position,
            click_pos: { x: 0, y: 0, z: 0 },
            block_runtime_id: 0,
            client_prediction: 'failure',
            client_cooldown_state: 'off'
          }
        }
      })
      try {
        this.client.queue('animate', {
          action_id: 'swing_arm',
          runtime_entity_id: this.runtimeId,
          data: 0,
          has_swing_source: false
        })
      } catch (_) {}
      this.pushChat({ system: true, message: 'Klik kanan pakai item di slot ' + (this.selectedHotbarSlot + 1) + '. Kalau item ini buka menu (mis. compass), cek tab Inventaris - bagian chest bakal muncul otomatis.' })
    } catch (err) {
      this.pushChat({ system: true, message: 'Klik kanan gagal (cek versi protokol): ' + err.message })
    }
  }

  // Tombol "klik" di salah satu slot chest yang lagi kebuka. Ini yang dipakai buat "pilih
  // opsi" di menu kayak chest pemilih server (klik item server ekonomi/vanilla, dst).
  //
  // Bedrock modern (server_authoritative_inventory) nggak lagi pakai inventory_transaction
  // buat mindahin/ngeklik item di container - itu sudah digantikan packet item_stack_request
  // (lihat types.yml ItemStackRequest, komentar resminya: "essentially a replacement of the
  // InventoryTransaction packet ... for inventory specific actions, such as moving items
  // around"). Kita kirim aksi 'take': ambil item dari slot container ke slot tas kita
  // (biar aman dipakai walau menunya beneran container fisik) - buat menu FAKE/plugin kayak
  // pemilih server, biasanya plugin cukup mendeteksi ADANYA klik/take di slot itu buat
  // trigger aksinya (pindah server dll), nggak peduli barangnya beneran kepindah atau enggak.
  //
  // stack_id WAJIB dikirim biar server percaya kita "tau" isi slot itu barang apa saat ini
  // (lihat stackIdOf() di atas) - kalau salah/kadaluarsa, request bisa ditolak, makanya hasil
  // asli dari server (ok/error) selalu dilaporkan balik lewat listener 'item_stack_response'
  // di connect(), bukan diasumsikan berhasil dari sini.
  clickContainerSlot (slotIndex) {
    if (!this.client || this.status !== 'spawned') return
    if (!this.container.open) {
      this.pushChat({ system: true, message: 'Nggak ada chest yang kebuka buat diklik.' })
      return
    }
    const idx = Number(slotIndex)
    const item = this.container.slots[idx]
    if (isEmptyItem(item)) {
      this.pushChat({ system: true, message: 'Slot chest itu kosong.' })
      return
    }

    // Cari slot tujuan di tas kita: pakai slot hotbar aktif kalau kosong, kalau nggak cari
    // slot kosong pertama (0-35). Kalau tas penuh semua, tetap coba ke slot hotbar aktif -
    // besar kemungkinan gagal/ke-swap, tapi buat menu FAKE (server-select dll) ini nggak
    // masalah karena tujuan sebenarnya cuma "trigger klik", bukan beneran mindahin barang.
    let destSlot = this.selectedHotbarSlot
    if (!isEmptyItem(this.inventory[destSlot])) {
      const emptyIdx = this.inventory.findIndex((it, i) => i < 36 && isEmptyItem(it))
      if (emptyIdx !== -1) destSlot = emptyIdx
    }

    const requestId = ++this._stackRequestId
    const desc = 'Klik slot chest #' + (idx + 1)
    try {
      this.client.queue('item_stack_request', {
        requests: [{
          request_id: requestId,
          actions: [{
            type_id: 'take',
            count: item.count || 1,
            source: {
              slot_type: { container_id: 'container' },
              slot: idx,
              stack_id: stackIdOf(item)
            },
            destination: {
              slot_type: { container_id: 'hotbar_and_inventory' },
              slot: destSlot,
              stack_id: 0
            }
          }],
          // WAJIB ada di protokol Bedrock terbaru (types.yml ItemStackRequest) - kalau
          // kelewat, serializer crash pas baca .length dari custom_names yang undefined
          // ("SizeOf error for undefined: Cannot read properties of undefined (reading
          // 'length')"). custom_names cuma dipakai server buat kasus rename item
          // (anvil/dsb) - kosongin aja karena di sini bukan itu. cause juga wajib ada
          // (enum FilterCause) - 0 dipakai sebagai default netral, servernya nggak
          // sensitif ke ini buat aksi 'take' biasa.
          custom_names: [],
          cause: 0
        }]
      })
      this.pushChat({ system: true, message: desc + ' - dikirim, nunggu balasan server...' })

      // DEBUG afk: log stack_id & item raw biar keliatan bedanya sama isanc
      try {
        // eslint-disable-next-line no-console
        console.log('[click] slot', idx, 'item', JSON.stringify(item), 'stack_id', stackIdOf(item), 'dest', destSlot)
      } catch (_) {}

      const timeout = setTimeout(() => {
        if (this._pendingStackRequests.has(requestId)) {
          this._pendingStackRequests.delete(requestId)
          this.pushChat({ system: true, message: desc + ' - belum ada balasan server dalam ' + Math.round(ACTION_CONFIRM_TIMEOUT_MS / 1000) + ' detik.' })
        }
      }, ACTION_CONFIRM_TIMEOUT_MS)
      this._pendingStackRequests.set(requestId, { desc, at: Date.now(), timeout })
    } catch (err) {
      this.pushChat({ system: true, message: 'Klik slot chest gagal (cek versi protokol): ' + err.message })
    }
  }

  setAfk (enabled) {
    this.afk = !!enabled
    if (this.afk) {
      this._startAfk()
    } else {
      this._stopAfk()
    }
  }

  _startAfk () {
    if (this._afkTimer) return
    this._afkTimer = setInterval(() => {
      if (this.status !== 'spawned' || !this.client) return
      // jitter kecil: noleh dikit + lompat, cukup lewat player_auth_input
      // yang sudah rutin dikirim tiap tick oleh _tick(); di sini kita cuma
      // ubah state-nya (yaw & jump) supaya kelihatan "aktif" ke server.
      this.turn((Math.random() * 20) - 10, 0)
      this.jump()
    }, AFK_INTERVAL_MS)
  }

  _stopAfk () {
    if (this._afkTimer) {
      clearInterval(this._afkTimer)
      this._afkTimer = null
    }
  }

  disconnect () {
    this._stopMoveLoop()
    this._stopAfk()
    clearTimeout(this._breakTimeout)
    clearTimeout(this._pendingBlockTimeout)
    clearTimeout(this._pendingContainerOpenTimeout)
    for (const pending of this._pendingStackRequests.values()) clearTimeout(pending.timeout)
    this._pendingStackRequests.clear()
    try {
      if (this.client) this.client.close()
    } catch (_) {}
    this.status = 'disconnected'
  }
}

function createBot (config) {
  const id = nowId()
  const bot = new Bot(id, config)
  bots.set(id, bot)
  bot.connect()
  return id
}

function getBot (id) {
  return bots.get(id) || null
}

function listBots () {
  return Array.from(bots.values()).map(b => b.toStatusJSON())
}

function removeBot (id) {
  const bot = bots.get(id)
  if (!bot) return false
  bot.disconnect()
  bots.delete(id)
  return true
}

module.exports = { createBot, getBot, listBots, removeBot }