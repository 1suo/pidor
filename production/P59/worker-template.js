var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../server/cloudflare-worker.ts
import { DurableObject as DurableObject2 } from "cloudflare:workers";

// ../shared/initialDeal.ts
var INITIAL_DEAL_STEP_MS = 355;
var INITIAL_DEAL_LEAD_MS = 350;
var INITIAL_DEAL_FINISH_MS = 180;
function initialCardCount(withUnderlaid) {
  return withUnderlaid ? 3 : 1;
}
__name(initialCardCount, "initialCardCount");
function initialDealDuration(playerCount, withUnderlaid) {
  return initialCardCount(withUnderlaid) * playerCount * INITIAL_DEAL_STEP_MS + INITIAL_DEAL_FINISH_MS;
}
__name(initialDealDuration, "initialDealDuration");

// ../server/gameLogic.ts
var RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
var SUITS = ["hearts", "diamonds", "clubs", "spades"];
var VIOLATION_WINDOW_MS = 15e3;
var RANK_VALUE = {
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  "J": 11,
  "Q": 12,
  "K": 13,
  "A": 14
};
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${rank}_of_${suit}` });
    }
  }
  return shuffle(deck);
}
__name(createDeck, "createDeck");
function shuffle(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}
__name(shuffle, "shuffle");
const PIDOR_PHASE_TRANSITIONS={LOBBY:["DEALING"],DEALING:["PENALTY_REVIEW","PENALTY_DISTRIBUTION"],PENALTY_REVIEW:["PENALTY_DISTRIBUTION"],PENALTY_DISTRIBUTION:["MAIN_GAME"],MAIN_GAME:["ENDED"],ENDED:[]};
var PidorGame = class {
  static {
    __name(this, "PidorGame");
  }
  state;
  penaltyDebts = {};
  penaltyQueue = [];
  previousDeckSuit = null;
  lockedDrawCards = [];
  initialProtectedCards = [];
  playSequence = 0;
  violations = [];
  lastAccusationAt = {};
  reviewDeadlineAt = 0;
  onPenalty = null;
  transitionPhase(next,reason){const current=this.state.phase;if(current===next)return false;if(!PIDOR_PHASE_TRANSITIONS[current]?.includes(next))throw Error("Invalid phase: "+current+" to "+next);this.state.phase=next;this.state.phaseSequence=(this.state.phaseSequence||0)+1;this.state.phaseEnteredAt=Date.now();this.state.phaseCause=reason;return true}
  reconcilePhase(){const s=this.state;switch(s.phase){
    case "DEALING":return s.deck.length===0&&!s.activeCard?this.finishDealAfterTrump():false;
    case "PENALTY_REVIEW":this.violations=[];this.reviewDeadlineAt=0;s.reviewDeadlineAt=0;this.transitionToPenaltyDistribution();return true;
    case "PENALTY_DISTRIBUTION":{
      let changed=this.ensureSpadeSixTransfers();
      const owed=()=>Object.values(this.penaltyDebts||{}).reduce((a,g)=>a+Object.values(g).reduce((b,n)=>b+Math.max(0,Number(n)||0),0),0);
      const sixOwed=()=>Object.values(s.finalSixPending||{}).some(n=>n>0);
      if(!this.penaltyQueue?.length&&(owed()>0||sixOwed())){this.penaltyQueue=this.buildPenaltyQueue();changed=true}
      while(this.penaltyQueue?.length){
        const q=this.penaltyQueue[0],giver=s.players.find(p=>p.id===q.giverId),receiver=s.players.find(p=>p.id===q.receiverId);
        const special=q.special===true;
        const left=special?(s.finalSixPending?.[q.giverId]||0):(this.penaltyDebts[q.receiverId]?.[q.giverId]||0);
        if(giver&&receiver&&giver.id!==receiver.id&&giver.hand.length>=(special?1:2)&&giver.hand.some(card=>card.id!=="6_of_spades")&&left>0)break;
        this.penaltyQueue.shift();
        if(special){if(s.finalSixPending)delete s.finalSixPending[q.giverId]}
        else if(this.penaltyDebts[q.receiverId]?.[q.giverId]>0)this.penaltyDebts[q.receiverId][q.giverId]--;
        changed=true;
      }
      if(!this.penaltyQueue?.length){this.transitionToMainGame();return true}
      return changed;
    }
    case "MAIN_GAME":{
      const active=s.players.filter(p=>!p.hasExited);
      if(!active.length&&s.players.length){const loser=s.players.find(p=>p.id===s.finishOrder?.at(-1))||s.players.at(-1);loser.hasExited=false;loser.onDuty=true;loser.finishPlace=s.players.length;this.transitionPhase("ENDED","recover-no-active");return true}
      if(active.length===1){const loser=active[0];if(s.currentTrick.length){s.discardPile.push(...s.currentTrick);s.currentTrick=[]}loser.onDuty=true;loser.finishPlace=s.players.length;s.finishOrder??=[];if(!s.finishOrder.includes(loser.id))s.finishOrder.push(loser.id);s.trickTargetId=null;this.transitionPhase("ENDED","recover-one-remaining");return true}
      if(active.length&&!active.some(p=>p.id===s.players[s.turnIndex]?.id)){s.turnIndex=s.players.findIndex(p=>p.id===active[0].id);return true}
    }
  }return false}
  auditIntegrity(){
    const s=this.state,errors=[],ps=Array.isArray(s.players)?s.players:[];
    if(!Object.hasOwn(PIDOR_PHASE_TRANSITIONS,s.phase))errors.push("unknown phase");
    if(ps.length>6||new Set(ps.map(p=>p.id)).size!==ps.length)errors.push("invalid player identities");
    if(s.phase==="LOBBY")return errors;
    if(ps.length<2||!Number.isInteger(s.turnIndex)||s.turnIndex<0||s.turnIndex>=ps.length)errors.push("invalid turn");
    const cards=[...(s.deck||[]),...(s.discardPile||[]),...(s.currentTrick||[])];
    for(const p of ps)cards.push(...(p.hand||[]),...(p.stumps||[]));
    if(s.activeCard?.card){if(!ps.some(p=>p.id===s.activeCard.ownerId))errors.push("missing active owner");cards.push(s.activeCard.card)}
    else if(s.activeCard)errors.push("empty active card");
    if(cards.length!==36)errors.push("expected 36 cards; got "+cards.length);
    const ids=new Set();
    for(const c of cards){
      if(!c||!RANKS.includes(c.rank)||!SUITS.includes(c.suit)||c.id!==c.rank+"_of_"+c.suit)errors.push("malformed card");
      else if(ids.has(c.id))errors.push("duplicate "+c.id);
      else ids.add(c.id);
    }
    if(s.phase!=="DEALING"&&((s.deck||[]).length||s.activeCard))errors.push("dealing cards remain after transition");
    if(Array.isArray(s.trickSkippedPlayerIds)&&(new Set(s.trickSkippedPlayerIds).size!==s.trickSkippedPlayerIds.length||s.trickSkippedPlayerIds.some(id=>!ps.some(p=>p.id===id))))errors.push("invalid trick skips");
    if(s.turnClock?.status&&!["IDLE","RUNNING","PAUSED","EXPIRED"].includes(s.turnClock.status))errors.push("invalid clock");
    return errors.slice(0,12);
  }
  snapshot() {
    return { state: this.state, penaltyDebts: this.penaltyDebts, penaltyQueue: this.penaltyQueue, previousDeckSuit: this.previousDeckSuit, lockedDrawCards: this.lockedDrawCards, initialProtectedCards: this.initialProtectedCards, playSequence: this.playSequence, violations: this.violations, lastAccusationAt: this.lastAccusationAt, reviewDeadlineAt: this.reviewDeadlineAt };
  }
  restore(saved) {
    this.state = saved.state;
    this.penaltyDebts = saved.penaltyDebts || {};
    this.penaltyQueue = saved.penaltyQueue || this.buildPenaltyQueue();
    this.previousDeckSuit = saved.previousDeckSuit || null;
    this.lockedDrawCards = saved.lockedDrawCards || [];
    this.initialProtectedCards = this.state.phase === "DEALING" ? this.state.players.flatMap((player) => player.stumps.slice(0, this.state.underlaidCards === false ? 1 : 2).map((card) => card.id)) : (saved.initialProtectedCards || []);
    this.playSequence = saved.playSequence || Math.max(0, ...this.state.players.map(p=>p.lastEmptyPlay||0));
    this.state.finishOrder ??= [];
    // Only the two hidden underlaid cards are protected; the third exposed starting card may be transferred if legal.
    this.violations = saved.violations || [];
    this.lastAccusationAt = saved.lastAccusationAt || {};
    this.reviewDeadlineAt=Number(saved.reviewDeadlineAt||this.state.reviewDeadlineAt||0);this.state.phaseSequence??=0;this.state.phaseEnteredAt??=Date.now();if(this.state.phase==="PENALTY_REVIEW"&&!this.reviewDeadlineAt)this.reviewDeadlineAt=Date.now()+VIOLATION_WINDOW_MS;if(this.state.phase==="PENALTY_REVIEW")this.state.reviewDeadlineAt=this.reviewDeadlineAt;
  }
  constructor(playerIds) {
    this.state = {
      phase: "LOBBY",
      players: playerIds.map((p) => ({
        id: p.id,
        name: p.name,
        hand: [],
        stumps: [],
        penalties: 0,
        isReady: false,
        onDuty: false,
        hasExited: false
      })),
      deck: [],
      trumpSuit: null,
      attackerId: null,
      currentTrick: [],
      trickTargetId: null,
      discardPile: [],
      turnIndex: 0,
      lastDrawnPlayerIdx: null,
      activeCard: null
    };
  }
  start(underlaidCards = this.state.underlaidCards !== false) {
    this.state.underlaidCards = underlaidCards;
    this.violations = [];
    this.lastAccusationAt = {};
    this.reviewDeadlineAt = 0;
    this.state.deck = createDeck();
    this.state.finishOrder = [];
    this.playSequence = 0;
    this.state.lastDrawEvent = void 0;
    this.state.penaltyLog = [];
    this.state.dealingTurnSerial = 0;
    this.state.outOfTurnUsed = {};
    this.state.spadeSixOwnerId = null;
    this.state.spadeSixPenaltyApplied = false;
    this.penaltyDebts = {};
    this.penaltyQueue = [];
    this.state.finalSixTransfersApplied = false;
    this.state.finalSixRecipientId = null;
    this.state.finalSixPending = {};
    this.lockedDrawCards = [];
    for (const player of this.state.players) {
      player.stumps = [];
      player.hand = [];
      player.hasExited = false;
      player.penalties = 0;
      player.onDuty = false;
      player.finishPlace = void 0;
      player.lastEmptyPlay = void 0;
    }
    for (let round = 0; round < initialCardCount(underlaidCards); round++) {
      for (const player of this.state.players) player.stumps.push(this.state.deck.pop());
    }
    this.initialProtectedCards = this.state.players.flatMap((player) => player.stumps.slice(0, underlaidCards === false ? 1 : 2).map((card) => card.id));
    this.state.initialDealAt = Date.now() + INITIAL_DEAL_LEAD_MS;
    this.state.initialDealEndsAt = this.state.initialDealAt + initialDealDuration(this.state.players.length, underlaidCards);
    this.state.firstTurnSpinAt = this.state.initialDealEndsAt + 120;
    this.state.firstTurnSpinEndsAt = this.state.firstTurnSpinAt + 3200;
    // Start only after the full roulette result and fade-out are gone.
    this.state.firstTurnReadyAt = this.state.firstTurnSpinEndsAt + 1200;
    this.state.firstTurnSpinRevolutions = 4 + Math.floor(Math.random() * 3);
    this.state.trumpSuit = null;
    this.previousDeckSuit = null;
    this.transitionPhase("DEALING","start");
    this.state.turnIndex = Math.floor(Math.random() * Math.max(1, this.state.players.length));
    console.log("[GAME] Random first turn:", this.state.players[this.state.turnIndex]?.name);
  }
  canBeat(card, target) {
    if (!target) return false;
    if (card.rank === "6") return card.suit !== "spades" && target.rank === "A";
    return RANK_VALUE[card.rank] === RANK_VALUE[target.rank] + 1;
  }
  canMoveTopCard(playerId) {
    const p = this.state.players.find((p2) => p2.id === playerId);
    const top = p?.stumps.at(-1);
    return this.state.phase === "DEALING" && !!top && p.stumps.length > (this.state.underlaidCards === false ? 1 : 2) && !this.lockedDrawCards.includes(top.id) && !this.initialProtectedCards.includes(top.id);
  }
  getPlayerIdx(id) {
    return this.state.players.findIndex((p) => p.id === id);
  }
  /**
   * Record an observable violation; never award a penalty automatically.
   * Another player must explicitly accuse the offender for it to count.
   */
  addPenalty(idx, reason, cardId) {
    if (idx < 0 || this.state.phase !== "DEALING") return;
    const offenderId = this.state.players[idx]?.id;
    if (!offenderId) return;
    const now = Date.now();
    this.violations = this.violations.filter((v) => now - v.createdAt < VIOLATION_WINDOW_MS);
    if (this.violations.some((v) => v.playerId === offenderId && v.reason === reason && v.cardId === cardId && now - v.createdAt < 2500)) return;
    this.violations.push({ id: crypto.randomUUID(), playerId: offenderId, reason, createdAt: now, cardId });
    if (this.violations.length > 80) this.violations.shift();
  }
  accusableTargets(observerId) {
    const now = Date.now();
    if (!this.state.players.some((p) => p.id === observerId)) return [];
    return [...new Set(this.violations.filter((v) => v.playerId !== observerId && now - v.createdAt < VIOLATION_WINDOW_MS).map((v) => v.playerId))];
  }
  canAccuseNow(playerId) {
    return Date.now() - (this.lastAccusationAt[playerId] || 0) >= 1500;
  }
  /**
   * A caught opportunistic draw is moved to the offender's pile even if
   * they already laid it on an opponent. If no one accuses within 15s,
   * its placement stands. The card is never copied or destroyed.
   */
  reclaimCaughtCard(offenderId, cardId) {
    const offender = this.state.players.find((p) => p.id === offenderId);
    if (!offender || offender.stumps.some((c) => c.id === cardId)) return;
    let seized;
    if (this.state.activeCard?.card.id === cardId) {
      seized = this.state.activeCard.card;
      this.state.activeCard = null;
    } else {
      for (const player of this.state.players) {
        for (const pile of [player.stumps, player.hand]) {
          const index = pile.findIndex((c) => c.id === cardId);
          if (index !== -1) {
            seized = pile.splice(index, 1)[0];
            break;
          }
        }
        if (seized) break;
      }
    }
    if (seized) {
      offender.stumps.push(seized);
      this.lockedDrawCards.push(cardId);
      this.checkPhaseEnd();
    }
  }
  // P43: a confirmed penalty forfeits the recipient's current turn, never their cards.
  endPenalizedTurn(playerId) {
    const s=this.state, idx=this.getPlayerIdx(playerId), phase=s.phase;
    if(idx<0||!s.players.length||phase==="LOBBY"||phase==="ENDED")return false;
    if(phase==="DEALING"){
      if(s.players[s.turnIndex]?.id!==playerId)return false;
      if(s.activeCard?.ownerId===playerId){
        s.players[idx].stumps.push(s.activeCard.card);
        s.activeCard=null;
      }
      s.turnIndex=(idx+1)%s.players.length;
      s.dealingTurnSerial=(s.dealingTurnSerial||0)+1;
      this.checkPhaseEnd();
      return true;
    }
    if(phase==="MAIN_GAME"){
      if(s.players[s.turnIndex]?.id!==playerId)return false;
      const skipped=s.trickSkippedPlayerIds??=[];
      if(!skipped.includes(playerId))skipped.push(playerId);
      this.advanceTurn();
      s.trickTargetId=s.currentTrick.length?s.players[s.turnIndex]?.id||null:null;
      this.checkTrickCompletion();
      return true;
    }
    if(phase==="PENALTY_DISTRIBUTION")return false;
    // Review has no individual turn to end.
    return false;
  }
  accuse(accuserId, accusedId) {
    if (this.state.phase !== "DEALING") return null;
    const accuser = this.state.players.find((p) => p.id === accuserId && !p.hasExited);
    const accused = this.state.players.find((p) => p.id === accusedId);
    if (!accuser || !accused || accuserId === accusedId) return null;
    const now = Date.now();
    if (now - (this.lastAccusationAt[accuserId] || 0) < 1500) return null;
    this.lastAccusationAt[accuserId] = now;
    this.violations = this.violations.filter((v) => now - v.createdAt < VIOLATION_WINDOW_MS);
    const index = this.violations.findIndex((v) => v.playerId === accusedId);
    const correct = index !== -1;
    const confirmedViolation = correct ? this.violations.splice(index, 1)[0] : null;
    const reason = confirmedViolation?.reason || "\u041B\u043E\u0436\u043D\u043E\u0435 \u043E\u0431\u0432\u0438\u043D\u0435\u043D\u0438\u0435";
    if (confirmedViolation?.cardId) this.reclaimCaughtCard(accusedId, confirmedViolation.cardId);
    const punished = correct ? accused : accuser;
    punished.penalties++;
    this.endPenalizedTurn(punished.id);
    this.onPenalty?.(punished.id, reason, accuserId);
    return { correct, accusedId, penalizedId: punished.id, reason, accuserId, accuserName: accuser.name };
  }
  expireReview() {
    if (this.state.phase !== "PENALTY_REVIEW" || !this.reviewDeadlineAt || Date.now() < this.reviewDeadlineAt) return false;
    this.violations = [];
    this.transitionToPenaltyDistribution();
    return true;
  }
  finishReview(playerId) {
    if (this.state.phase !== "PENALTY_REVIEW") return ["PENALTY_DISTRIBUTION", "MAIN_GAME", "ENDED"].includes(this.state.phase);
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.isReady = true;
    if (this.state.players.every((p) => p.isReady || p.isBot)) {
      this.violations = [];
      this.transitionToPenaltyDistribution();
    }
    return true;
  }
  enterReview() {
    this.transitionPhase("PENALTY_REVIEW","deck-empty");
    this.reviewDeadlineAt = Date.now() + VIOLATION_WINDOW_MS;
    this.state.reviewDeadlineAt = this.reviewDeadlineAt;
    for (const player of this.state.players) player.isReady = !!player.isBot;
  }
  // --- Dealing Phase ---
  takeFromDeck(actorId) {
    const idx = this.getPlayerIdx(actorId);
    if (idx === -1 || this.state.phase !== "DEALING" || !this.state.deck.length) return false;
    const outOfTurn = idx !== this.state.turnIndex;
    if(outOfTurn && this.state.outOfTurnUsed?.[actorId]===this.state.dealingTurnSerial)return false;
    if (this.state.activeCard) {
      if (this.state.activeCard.ownerId === actorId) this.addPenalty(idx, "\u041F\u044B\u0442\u0430\u0435\u0442\u0441\u044F \u0432\u044B\u0442\u044F\u043D\u0443\u0442\u044C \u0432\u0442\u043E\u0440\u0443\u044E \u043A\u0430\u0440\u0442\u0443");
      return false;
    }
    if (!outOfTurn && this.canMoveTopCard(actorId)) {
      const targetIdx = this.findOtherBeatTarget(idx);
      if (targetIdx !== -1) this.addPenalty(idx, "\u041D\u0435 \u043A\u0438\u043D\u0443\u043B \u0441\u0432\u043E\u044E \u043A\u0430\u0440\u0442\u0443 \u043D\u0430 " + this.state.players[targetIdx].name);
    }
    if(outOfTurn)(this.state.outOfTurnUsed??={})[actorId]=this.state.dealingTurnSerial??0;
    const card = this.state.deck.pop();
    const isSpadeSix = card.rank === "6" && card.suit === "spades";
    const isLast = this.state.deck.length === 0;
    const originalTop = this.state.players[idx].stumps.at(-1);
    if (isLast) this.state.trumpSuit = card.suit === "spades" ? null : card.suit;
    this.previousDeckSuit = card.suit;
    this.state.lastDrawnPlayerIdx = idx;
    this.state.lastDrawEvent = {
      playerId: actorId,
      outOfTurn,
      forcedSelf: isSpadeSix || isLast,
      finalCard: isLast ? card : void 0,
      createdAt: Date.now()
    };
    if (outOfTurn) this.addPenalty(idx, "\u0412\u044B\u0442\u044F\u043D\u0443\u043B \u043A\u0430\u0440\u0442\u0443 \u0432\u043D\u0435 \u043E\u0447\u0435\u0440\u0435\u0434\u0438", card.id);
    if (isSpadeSix) {
      this.state.spadeSixOwnerId = actorId;
      this.state.spadeSixPenaltyApplied = true;
      this.state.players[idx].penalties++;
      this.onPenalty?.(actorId,"6♠: обязательная похуёвая",null);
    }
    if (isSpadeSix || isLast) {
      this.lockedDrawCards.push(card.id);
      this.state.players[idx].stumps.push(card);
      if (!outOfTurn && (isSpadeSix || !this.canBeat(card, originalTop))) {
        this.state.turnIndex = (this.state.turnIndex + 1) % this.state.players.length;
        this.state.dealingTurnSerial=(this.state.dealingTurnSerial||0)+1;
      }
      this.checkPhaseEnd();
      return true;
    }
    this.state.activeCard = { card, ownerId: actorId, fromDeck: true };
    return true;
  }
  takeFromPile(actorId, cardId) {
    const idx = this.getPlayerIdx(actorId);
    if (idx === -1 || this.state.phase !== "DEALING" || this.state.activeCard) return false;
    if (idx !== this.state.turnIndex) return false;
    const p = this.state.players[idx];
    if (p.stumps.length <= (this.state.underlaidCards === false ? 1 : 2)) return false;
    const top = p.stumps[p.stumps.length - 1];
    if (top.id !== cardId || this.lockedDrawCards.includes(cardId) || this.initialProtectedCards.includes(cardId)) return false;
    p.stumps.pop();
    this.state.activeCard = { card: top, ownerId: actorId, fromDeck: false };
    return true;
  }
  moveTopTo(actorId, targetId) {
    if (!this.canMoveTopCard(actorId) || this.state.activeCard) return false;
    const actor = this.state.players.find((p) => p.id === actorId);
    const top = actor.stumps.at(-1);
    if (!this.state.players.some((p) => p.id === targetId)) return false;
    if (!this.takeFromPile(actorId, top.id)) return false;
    if (this.placeActiveCard(actorId, targetId)) return true;
    actor.stumps.push(top);
    this.state.activeCard = null;
    return false;
  }
  drawTo(actorId, targetId) {
    if (!this.state.players.some((p) => p.id === actorId) || !this.state.players.some((p) => p.id === targetId) || this.state.phase !== "DEALING" || !this.state.deck.length || this.state.activeCard) return false;
    if (!this.takeFromDeck(actorId)) return false;
    return !this.state.activeCard || this.placeActiveCard(actorId, targetId);
  }
  placeActiveCard(actorId, targetId) {
    if (this.state.phase !== "DEALING") return false;
    const actorIdx = this.getPlayerIdx(actorId);
    const targetIdx = this.getPlayerIdx(targetId);
    if (actorIdx < 0 || targetIdx < 0 || !this.state.activeCard) return false;
    if (this.state.activeCard.ownerId !== actorId) return false;
    const { card, fromDeck } = this.state.activeCard;
    if (!fromDeck && actorIdx === targetIdx) return false;
    const opportunistic = actorIdx !== this.state.turnIndex && fromDeck && this.state.lastDrawEvent?.playerId === actorId && this.state.lastDrawEvent.outOfTurn;
    if (actorIdx !== this.state.turnIndex && !opportunistic) return false;
    const isSelf = actorIdx === targetIdx;
    const top = this.state.players[targetIdx].stumps.at(-1);
    const legal = top ? this.canBeat(card, top) : isSelf;
    let first = -1;
    for (let i = 1; i < this.state.players.length; i++) {
      const idx = (actorIdx + i) % this.state.players.length;
      if (this.canBeat(card, this.state.players[idx].stumps.at(-1))) {
        first = idx;
        break;
      }
    }
    // P58 strict: wrong rank/suit sequence or skipped earlier eligible opponent never reaches a pile.
    if (!isSelf && (!legal || first !== targetIdx)) return false;
    if (isSelf && first !== -1) return false;
    if (!isSelf && !legal) this.addPenalty(actorIdx, "\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u043F\u043E\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C", card.id);
    else if (isSelf && first !== -1) this.addPenalty(actorIdx, "\u041D\u0435 \u043F\u0435\u0440\u0435\u043A\u0438\u043D\u0443\u043B \u043A\u0430\u0440\u0442\u0443 \u0441\u043E\u043F\u0435\u0440\u043D\u0438\u043A\u0443", card.id);
    else if (!isSelf && first !== -1 && first !== targetIdx) {
      this.addPenalty(actorIdx, "\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u043B \u0438\u0433\u0440\u043E\u043A\u0430 \u043F\u043E \u043A\u0440\u0443\u0433\u0443", card.id);
    }
    this.state.players[targetIdx].stumps.push(card);
    this.state.activeCard = null;
    // P42: an opponent throw NEVER ends the dealing turn (even when invalid).
    // A drawn card placed on our own pile ends the turn only when it cannot
    // legally beat the previous top card. A legal rank chain keeps our turn.
    if (!opportunistic && isSelf && !legal) {
      this.state.turnIndex = (actorIdx + 1) % this.state.players.length;
      this.state.dealingTurnSerial=(this.state.dealingTurnSerial||0)+1;
    }
    this.checkPhaseEnd();
    return true;
  }
  findOtherBeatTarget(actorIdx) {
    const p = this.state.players[actorIdx];
    if (p.stumps.length <= (this.state.underlaidCards === false ? 1 : 2)) return -1;
    const top = p.stumps[p.stumps.length - 1];
    for (let i = 1; i < this.state.players.length; i++) {
      const idx = (actorIdx + i) % this.state.players.length;
      if (this.canBeat(top, this.state.players[idx].stumps[this.state.players[idx].stumps.length - 1])) return idx;
    }
    return -1;
  }
  finishDealAfterTrump() {
    if (this.state.phase !== "DEALING" || this.state.deck.length || this.state.activeCard) return false;
    this.violations = [];
    this.reviewDeadlineAt = 0;
    this.state.reviewDeadlineAt = 0;
    this.transitionToPenaltyDistribution();
    return true;
  }
  checkPhaseEnd() {
    if (this.state.phase === "DEALING" && this.state.deck.length === 0 && !this.state.activeCard) this.finishDealAfterTrump();
  }
  ensureSpadeSixTransfers() {
    if (this.state.phase !== "PENALTY_DISTRIBUTION" || this.state.finalSixTransfersApplied) return false;
    const s=this.state,last=s.lastDrawEvent;
    const lastOwner=last?.finalCard?.rank==="6"&&last.finalCard.suit==="spades"?last.playerId:null;
    const owner=s.spadeSixOwnerId||lastOwner;
    if(!owner)return false;
    const recipient=s.players.find(p=>p.id===owner);
    if(!recipient)return false;
    if(!s.spadeSixPenaltyApplied){
      recipient.penalties=(Number(recipient.penalties)||0)+1;
      s.spadeSixPenaltyApplied=true;
      this.onPenalty?.(owner,"6♠: обязательная похуёвая",null);
    }
    s.spadeSixOwnerId=owner;
    s.finalSixTransfersApplied=true;
    s.finalSixRecipientId=owner;
    s.finalSixPending={};
    for(const giver of s.players){
      if(giver.id===owner||giver.hasExited)continue;
      // A mandatory six-spades transfer can use the giver's final card, but NEVER 6♠ itself.
      if(!giver.hand.some(card=>card.id!=="6_of_spades")){
        const extra=giver.stumps.findIndex(card=>card.id!=="6_of_spades");
        if(extra>=0)giver.hand.push(...giver.stumps.splice(extra,1));
      }
      if(giver.hand.some(card=>card.id!=="6_of_spades"))s.finalSixPending[giver.id]=1;
    }
    this.penaltyQueue=this.buildPenaltyQueue();
    return true;
  }
  buildPenaltyQueue() {
    const queue = [];
    for (const giver of this.state.players) {
      if ((this.state.finalSixPending?.[giver.id] || 0) > 0 && this.state.finalSixRecipientId && this.state.finalSixRecipientId !== giver.id) queue.push({ giverId: giver.id, receiverId: this.state.finalSixRecipientId, special: true });
    }
    const debts = Object.fromEntries(Object.entries(this.penaltyDebts).map(([receiver, givers]) => [receiver, { ...givers }]));
    let pending = true;
    while (pending) {
      pending = false;
      for (const giver of this.state.players) {
        for (const receiver of this.state.players) {
          if ((debts[receiver.id]?.[giver.id] || 0) > 0) {
            queue.push({ giverId: giver.id, receiverId: receiver.id });
            debts[receiver.id][giver.id]--;
            pending = true;
            break;
          }
        }
      }
    }
    return queue;
  }
  currentPenaltyTurn() {
    return this.penaltyQueue[0] || null;
  }
  transitionToPenaltyDistribution() {
    if (!this.state.spadeSixOwnerId && this.lockedDrawCards.includes("6_of_spades")) {
      this.state.spadeSixOwnerId=this.state.players.find(p=>p.stumps.some(card=>card.id==="6_of_spades"))?.id||null;
    }
    this.lockedDrawCards = [];
    this.state.reviewDeadlineAt = 0;
    this.transitionPhase("PENALTY_DISTRIBUTION","review-complete");
    for (const p of this.state.players) p.hand = p.stumps.splice(this.state.underlaidCards === false ? 0 : 2);
    this.penaltyDebts = {};
    const sixOwner=this.state.spadeSixOwnerId||(this.state.lastDrawEvent?.finalCard?.id==="6_of_spades"?this.state.lastDrawEvent.playerId:null);
    for (const giver of this.state.players) {
      // Reserve one card for the mandatory six-spades handoff and preserve one card otherwise.
      const transferable=giver.hand.filter(card=>card.id!=="6_of_spades").length;
      const keep=giver.hand.some(card=>card.id==="6_of_spades")?0:1;
      const specialReserve=sixOwner&&sixOwner!==giver.id?1:0;
      let available=Math.max(0,transferable-keep-specialReserve);
      for (const receiver of this.state.players) {
        const ordinaryPenalty=Math.max(0,receiver.penalties-(receiver.id===sixOwner&&this.state.spadeSixPenaltyApplied?1:0));
        if(giver.id===receiver.id||ordinaryPenalty<=0||available<=0)continue;
        const owed=Math.min(ordinaryPenalty,available);
        (this.penaltyDebts[receiver.id]??={})[giver.id]=owed;
        available-=owed;
      }
    }
    const total=Object.values(this.penaltyDebts).flatMap(x=>Object.values(x)).reduce((a,b)=>a+b,0);
    this.ensureSpadeSixTransfers();
    this.penaltyQueue = this.buildPenaltyQueue();
    if (total === 0 && !this.penaltyQueue.length) this.transitionToMainGame();
  }
  givePenaltyCard(giverId, cardId, receiverId) {
    if (this.state.phase !== "PENALTY_DISTRIBUTION") return false;
    const giver = this.state.players.find(p => p.id === giverId);
    const receiver = this.state.players.find(p => p.id === receiverId);
    const current = this.currentPenaltyTurn();
    const special = current?.special === true;
    const remaining = special ? this.state.finalSixPending?.[giverId] : this.penaltyDebts[receiverId]?.[giverId];
    if (!giver || !receiver || giver.id === receiver.id || giver.hand.length < (special ? 1 : 2) || current?.giverId !== giverId || current.receiverId !== receiverId || !remaining) return false;
    const idx = giver.hand.findIndex(c => c.id === cardId);
    if (idx === -1 || giver.hand[idx].rank === "6" && giver.hand[idx].suit === "spades") return false;
    receiver.hand.push(giver.hand.splice(idx, 1)[0]);
    if (special) delete this.state.finalSixPending[giverId];
    else this.penaltyDebts[receiverId][giverId]--;
    this.penaltyQueue.shift();
    if (!this.penaltyQueue.length) this.transitionToMainGame();
    return true;
  }
  transitionToMainGame() {
    this.reviewDeadlineAt = 0;
    this.state.reviewDeadlineAt = 0;
    this.penaltyQueue = [];
    this.transitionPhase("MAIN_GAME","penalties-resolved");
    // P47: a player who finished the layout with only protected underlaid cards
    // still needs a playable hand when the main phase begins. Preserve cards,
    // do not reveal opponents' hands, and do not alter players with a hand.
    for (const player of this.state.players) {
      if (!player.hand.length && player.stumps.length) {
        player.hand.push(...player.stumps.splice(0));
      }
    }
    this.state.trickSkippedPlayerIds=[];
    this.state.trickTargetId = null;
    this.state.turnIndex = ((this.state.lastDrawnPlayerIdx ?? -1) + 1) % this.state.players.length;
    let checks=0;while(this.state.players[this.state.turnIndex]?.hasExited&&checks++<this.state.players.length)this.state.turnIndex=(this.state.turnIndex+1)%this.state.players.length;
    this.resolveFinishedPlayersAfterTrick();
  }
  // --- Main Game ---
  playCard(playerId, cardId) {
    const s=this.state;
    if(s.phase!=="MAIN_GAME")return false;
    const idx=this.getPlayerIdx(playerId);
    if(idx<0||idx!==s.turnIndex||s.players[idx]?.hasExited)return false;
    const player=s.players[idx],cardIdx=player.hand.findIndex(c=>c.id===cardId);
    if(cardIdx<0)return false;
    const card=player.hand[cardIdx],last=s.currentTrick.at(-1)||null;
    if(!this.isLegalMove(card,last))return false;
    player.hand.splice(cardIdx,1);
    this.playSequence++;
    if(!player.hand.length&&!player.stumps.length)player.lastEmptyPlay=this.playSequence;
    s.currentTrick.push(card);
    this.advanceTurn();
    s.trickTargetId=s.players[s.turnIndex]?.id||null;
    this.checkTrickCompletion();
    return true;
  }
  isLegalMove(card, target) {
    if (!target) return true;
    if (card.rank === "6" && target.rank === "A" && card.suit === target.suit) {
      return card.suit !== "spades";
    }
    const higher = RANK_VALUE[card.rank] > RANK_VALUE[target.rank];
    if (!this.state.trumpSuit) return card.suit === target.suit && higher;
    if (target.rank === "A" && (target.suit === "spades" || target.suit === this.state.trumpSuit)) return false;
    if (target.suit === "spades") return card.suit === "spades" && higher;
    if (target.suit === this.state.trumpSuit) return card.suit === this.state.trumpSuit && higher;
    if (card.suit === this.state.trumpSuit) return true;
    return card.suit === target.suit && higher;
  }
  takeTrick(playerId) {
    if(this.state.phase!=="MAIN_GAME")return false;
    const idx = this.getPlayerIdx(playerId);
    if (idx !== this.state.turnIndex || this.state.currentTrick.length === 0) return false;
    this.state.players[idx].hand.push(this.state.currentTrick.shift());
    this.advanceTurn();
    this.state.trickTargetId = this.state.currentTrick.length ? this.state.players[this.state.turnIndex]?.id || null : null;
    if (this.state.currentTrick.length === 0){this.state.trickSkippedPlayerIds=[];this.resolveFinishedPlayersAfterTrick()}
  }
  takeStumps(playerId) {
    const p = this.state.players.find((p2) => p2.id === playerId);
    if (p && !p.hasExited && p.stumps.length > 0 && this.state.phase === "MAIN_GAME" && p.hand.length === 0 && this.state.currentTrick.length === 0) {
      p.hand.push(...p.stumps);
      p.stumps = [];
    }
  }
  exitGame(playerId) {
    const p = this.state.players.find((candidate) => candidate.id === playerId);
    if (!p || p.hasExited || this.state.phase !== "MAIN_GAME" || this.state.currentTrick.length || p.hand.length || p.stumps.length) return;
    this.resolveFinishedPlayersAfterTrick();
  }
  resolveFinishedPlayersAfterTrick() {
    if (this.state.phase !== "MAIN_GAME" || this.state.currentTrick.length !== 0) return;
    const players = this.state.players, order = this.state.finishOrder ??= [];
    // Older saved rooms have no historic exit order; retain already-exited seats.
    for (const p of players) if (p.hasExited && !order.includes(p.id)) { order.push(p.id); p.finishPlace ??= order.length; }
    const finished = players.filter(p => !p.hasExited && p.hand.length === 0 && p.stumps.length === 0).sort((a,b) => (a.lastEmptyPlay || Number.MAX_SAFE_INTEGER) - (b.lastEmptyPlay || Number.MAX_SAFE_INTEGER) || players.indexOf(a) - players.indexOf(b));
    if (!finished.length) return;
    for (const p of finished) { p.hasExited = true; order.push(p.id); p.finishPlace = order.length; }
    const remaining = players.filter(p => !p.hasExited);
    if (remaining.length <= 1) {
      if (remaining.length === 1) { const loser = remaining[0]; loser.onDuty = true; loser.finishPlace = players.length; if (!order.includes(loser.id)) order.push(loser.id); }
      else { const loser = finished[finished.length - 1]; loser.hasExited = false; loser.onDuty = true; loser.finishPlace = players.length; }
      this.state.trickTargetId = null; this.transitionPhase("ENDED","last-player"); return;
    }
    if (players[this.state.turnIndex]?.hasExited) { let checked = 0; while (players[this.state.turnIndex]?.hasExited && checked++ < players.length) this.state.turnIndex = (this.state.turnIndex + 1) % players.length; }
    this.state.trickTargetId = null;
  }
  advanceTurn() {
    let next = (this.state.turnIndex + 1) % this.state.players.length;
    let skips=0;while(this.state.players[next]?.hasExited&&skips++<this.state.players.length)next=(next+1)%this.state.players.length;
    this.state.turnIndex = next;
  }
  checkTrickCompletion() {
    const active=this.state.players.filter(p=>!p.hasExited);
    const skipped=(this.state.trickSkippedPlayerIds||[]).filter(id=>active.some(p=>p.id===id));
    if(active.length&&this.state.currentTrick.length+skipped.length>=active.length){
      this.state.discardPile.push(...this.state.currentTrick);
      this.state.currentTrick=[];
      this.state.trickSkippedPlayerIds=[];
      this.state.trickTargetId=null;
      this.resolveFinishedPlayersAfterTrick();
    }
  }
};

// ../server/botStrategy.ts
function cardCost(card, trump) {
  return RANK_VALUE[card.rank] + (card.suit === trump ? 30 : 0) + (card.suit === "spades" ? 5 : 0);
}
__name(cardCost, "cardCost");
function firstTarget(game, actorId, card) {
  const players = game.state.players;
  const actorIdx = players.findIndex((player) => player.id === actorId);
  for (let i = 1; i < players.length; i++) {
    const target = players[(actorIdx + i) % players.length];
    const top = target.stumps.at(-1);
    if (top && game.canBeat(card, top)) return target.id;
  }
  return actorId;
}
__name(firstTarget, "firstTarget");
function nextBotMove(game, botIds) {
  const state = game.state;
  const isBot = /* @__PURE__ */ __name((id) => botIds.includes(id), "isBot");
  if (state.phase === "LOBBY" || state.phase === "ENDED") return null;
  const challenger = state.phase === "DEALING" ? state.players.find((p) => isBot(p.id) && !p.hasExited && game.canAccuseNow(p.id) && game.accusableTargets(p.id).length > 0) : null;
  if (state.phase === "PENALTY_REVIEW") return null;
  if (state.phase === "DEALING") {
    const actor2 = state.players[state.turnIndex];
    if (!actor2 || !isBot(actor2.id)) return null;
    if (state.activeCard) {
      if (state.activeCard.ownerId !== actor2.id) return null;
      return {
        type: "placeActiveCard",
        actorId: actor2.id,
        targetId: state.activeCard.fromDeck && state.deck.length === 0 ? actor2.id : firstTarget(game, actor2.id, state.activeCard.card)
      };
    }
    // Mandatory deterministic chain: transfer each legal top card, re-evaluate the newly
    // uncovered top on the following bot tick, and only then touch the central deck.
    // One atomic move avoids an intermediate activeCard state and a network race.
    const targetIndex = game.findOtherBeatTarget(state.turnIndex);
    if(game.canMoveTopCard(actor2.id) && targetIndex!==-1) {
      return { type:"moveTopTo", actorId:actor2.id, targetId:state.players[targetIndex].id };
    }
    // An accusation may be made when no mandatory top-card transfer remains.
    if(challenger && Math.random()<0.55){
      return {type:"accuse",actorId:challenger.id,accusedId:game.accusableTargets(challenger.id)[0]};
    }
    return state.deck.length ? { type:"drawCardFromDeck", actorId:actor2.id } : null;
  }
  if (state.phase === "PENALTY_DISTRIBUTION") {
    const turn = game.currentPenaltyTurn();
    if (!turn || !isBot(turn.giverId)) return null;
    const giver = state.players.find((p) => p.id === turn.giverId);
    if (!giver || giver.hand.length < (turn.special?1:2)) return null;
    const card = giver.hand.filter(card=>!(card.rank==="6"&&card.suit==="spades")).sort((a, b) => cardCost(b, state.trumpSuit) - cardCost(a, state.trumpSuit))[0];
    return card ? { type: "givePenaltyCard", actorId: giver.id, cardId: card.id, receiverId: turn.receiverId } : null;
  }
  if (state.currentTrick.length === 0) {
    for (const player of state.players) {
      if (!isBot(player.id) || player.hasExited || player.hand.length > 0) continue;
      return { type: player.stumps.length ? "takeStumps" : "exitGame", actorId: player.id };
    }
  }
  const actor = state.players[state.turnIndex];
  if (!actor || !isBot(actor.id) || actor.hasExited) return null;
  if (!actor.hand.length) {
    return state.currentTrick.length ? { type: "takeTrick", actorId: actor.id } : null;
  }
  const last = state.currentTrick.at(-1) || null;
  if (last && Math.random() < 0.06) {
    return { type: "takeTrick", actorId: actor.id };
  }
  // Prefer leads that someone might actually beat. Bots use only their own hand and public discard pile, never opponents' hidden hands.
  const known = new Set([...actor.hand, ...state.discardPile].map((card) => card.id));
  const beatsLeft = (card) => {
    let possible = 0;
    for (const suit of ["clubs", "diamonds", "hearts", "spades"]) {
      for (const rank of ["6", "7", "8", "9", "10", "J", "Q", "K", "A"]) {
        if (known.has(rank + "_of_" + suit)) continue;
        if (game.isLegalMove({ rank, suit }, card)) possible++;
      }
    }
    return possible;
  };
  const playable = actor.hand.filter((card) => game.isLegalMove(card, last)).sort((a, b) => last ? cardCost(a, state.trumpSuit) - cardCost(b, state.trumpSuit) : beatsLeft(b) - beatsLeft(a) || cardCost(a, state.trumpSuit) - cardCost(b, state.trumpSuit));
  if (playable.length) {
    // Periodically try another legal opening card instead of replaying the same unbeatably high-scored lead.
    // Follow-up responses still use the regular minimum-card strategy; no hidden cards are examined.
    const index = !last && playable.length > 1 && Math.random() < 0.24 ? 1 + Math.floor(Math.random() * Math.min(2, playable.length - 1)) : 0;
    return { type: "playCard", actorId: actor.id, cardId: playable[index].id };
  }
  return state.currentTrick.length ? { type: "takeTrick", actorId: actor.id } : null;
}
__name(nextBotMove, "nextBotMove");
function applyBotMove(game, move) {
  switch (move.type) {
    case "accuse":
      return game.accuse(move.actorId, move.accusedId) !== null;
    case "drawCardFromDeck":
      return game.takeFromDeck(move.actorId);
    case "takeFromPile":
      return game.takeFromPile(move.actorId, move.cardId);
    case "moveTopTo":
      return game.moveTopTo(move.actorId, move.targetId);
    case "placeActiveCard":
      return game.placeActiveCard(move.actorId, move.targetId);
    case "givePenaltyCard":
      return game.givePenaltyCard(move.actorId, move.cardId, move.receiverId);
    case "playCard": {
      const before = game.state.players.find((p) => p.id === move.actorId)?.hand.length;
      game.playCard(move.actorId, move.cardId);
      const after = game.state.players.find((p) => p.id === move.actorId)?.hand.length;
      return before !== void 0 && after === before - 1;
    }
    case "takeTrick": {
      const count = game.state.currentTrick.length;
      game.takeTrick(move.actorId);
      return game.state.currentTrick.length === count - 1;
    }
    case "takeStumps": {
      const before = game.state.players.find((p) => p.id === move.actorId)?.stumps.length ?? 0;
      game.takeStumps(move.actorId);
      return before > 0 && game.state.players.find((p) => p.id === move.actorId)?.stumps.length === 0;
    }
    case "exitGame": {
      game.exitGame(move.actorId);
      return !!game.state.players.find((p) => p.id === move.actorId)?.hasExited;
    }
  }
}
__name(applyBotMove, "applyBotMove");

// ../server/telegram.ts
function secretEquals(provided, expected) {
  const encoder = new TextEncoder();
  const left = encoder.encode(provided);
  const right = encoder.encode(expected);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    mismatch |= (left[i] || 0) ^ (right[i] || 0);
  }
  return mismatch === 0;
}
__name(secretEquals, "secretEquals");
async function callTelegram(env, method, body) {
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(method + ": " + (json.description || "Telegram API failure"));
  return json;
}
__name(callTelegram, "callTelegram");
function miniAppLink(origin, mode) {
  return origin + (mode === "bot" ? "/api/app?mode=bot&ui=20261113-p46" : "/api/app?mode=friends&ui=20261113-p46");
}
__name(miniAppLink, "miniAppLink");
async function replyToMessage(env, update, origin) {
  const message = update.message;
  if (!message?.chat || message.chat.type !== "private") return;
  const raw = (message.text || "").trim();
  const command = raw.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (!["/start", "/play", "/game", "/help"].includes(command)) return;
  if (command === "/start") {
    try { await callTelegram(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "🎮 Играть", web_app: { url: origin + "/api/app?ui=20261113-p46" } } }); }
    catch { /* Optional menu migration; /start links still work. */ }
  }

  const greeting = message.from?.first_name ? "\u041F\u0440\u0438\u0432\u0435\u0442, " + message.from.first_name.slice(0, 32) + "!\n\n" : "\u041F\u0440\u0438\u0432\u0435\u0442!\n\n";
  const text = command === "/help" ? "PIDOR \u2014 \u043A\u0430\u0440\u0442\u043E\u0447\u043D\u0430\u044F \u0438\u0433\u0440\u0430 \u043D\u0430 36 \u043A\u0430\u0440\u0442.\n\n\u0418\u0433\u0440\u0430\u0439\u0442\u0435 \u0441 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u043E\u043C \u0438\u043B\u0438 \u043F\u0440\u0438\u0433\u043B\u0430\u0441\u0438\u0442\u0435 \u0434\u0440\u0443\u0437\u0435\u0439. \u041E\u0442\u043A\u0440\u043E\u0439 \u0438\u0433\u0440\u0443 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u043D\u0438\u0436\u0435. \u0412\u043D\u0443\u0442\u0440\u0438 \u0435\u0441\u0442\u044C \u043A\u0440\u0430\u0442\u043A\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0438 \u0432\u044B\u0431\u043E\u0440 \u0440\u0435\u0436\u0438\u043C\u0430." : greeting + "\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 PIDOR!\n\n\u0412\u044B\u0431\u0438\u0440\u0430\u0439: \u0441\u044B\u0433\u0440\u0430\u0442\u044C \u0441 \u0431\u043E\u0442\u043E\u043C \u0438\u043B\u0438 \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u0434\u0440\u0443\u0437\u0435\u0439 \u0437\u0430 \u043E\u0434\u043D\u0438\u043C \u0441\u0442\u043E\u043B\u043E\u043C.";
  await callTelegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text,
    reply_markup: { inline_keyboard: [
      [{ text: "\u{1F916} \u0418\u0433\u0440\u0430\u0442\u044C \u0441 \u0431\u043E\u0442\u043E\u043C", web_app: { url: miniAppLink(origin, "bot") } }],
      [{ text: "\u{1F0CF} \u0418\u0433\u0440\u0430\u0442\u044C \u0441 \u0434\u0440\u0443\u0437\u044C\u044F\u043C\u0438", web_app: { url: miniAppLink(origin, "friends") } }]
    ] }
  });
}
__name(replyToMessage, "replyToMessage");
async function activateBot(env, origin) {
  try {
    const bot = await callTelegram(env, "getMe", {});
    const webhook = await callTelegram(env, "setWebhook", {
      url: origin + "/telegram/webhook",
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false
    });
    const menu = await callTelegram(env, "setChatMenuButton", {
      menu_button: { type: "web_app", text: "\u{1F3AE} \u0418\u0433\u0440\u0430\u0442\u044C", web_app: { url: origin + "/api/app?ui=20261113-p46" } }
    });
    await callTelegram(env, "setMyCommands", {
      commands: [
        { command: "start", description: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C PIDOR" },
        { command: "play", description: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0438\u0433\u0440\u0443 \u0441 \u0431\u043E\u0442\u043E\u043C \u0438\u043B\u0438 \u0434\u0440\u0443\u0437\u044C\u044F\u043C\u0438" },
        { command: "help", description: "\u041A\u0430\u043A \u0438\u0433\u0440\u0430\u0442\u044C" }
      ]
    });
    return Response.json({ ok: true, username: bot.result?.username, webhook: webhook.ok, menu: menu.ok });
  } catch (e) {
    console.error("Telegram activation error", String(e).replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]"));
    return Response.json({ error: "Telegram configuration failed. Check BotFather token and logs." }, { status: 502 });
  }
}
__name(activateBot, "activateBot");
async function handleTelegram(request, env) {
  const url = new URL(request.url);
  const configured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);
  if (url.pathname === "/telegram/status" && request.method === "GET") {
    return Response.json({ ready: configured, message: configured ? "Bot credentials configured" : "Waiting for BotFather credentials" });
  }
  if (url.pathname === "/telegram/activate" && request.method === "POST") {
    if (!configured) return Response.json({ error: "Configure Cloudflare secrets first" }, { status: 503 });
    if (!secretEquals(request.headers.get("X-Telegram-Setup-Key") || "", env.TELEGRAM_WEBHOOK_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) {
      return Response.json({ error: "Webhook secret must be 1-256 chars (letters, numbers, _ or -)" }, { status: 400 });
    }
    return activateBot(env, url.origin);
  }
  if (url.pathname === "/telegram/webhook" && request.method === "POST") {
    if (!configured) return new Response("Not configured", { status: 503 });
    const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!secretEquals(received, env.TELEGRAM_WEBHOOK_SECRET)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (Number(request.headers.get("content-length") || 0) > 64e3) {
      return new Response("Payload too large", { status: 413 });
    }
    try {
      const update = await request.json();
      await replyToMessage(env, update, url.origin);
      return new Response("OK", { status: 200 });
    } catch (e) {
      console.warn("Telegram update handling error", String(e).slice(0, 240));
      return new Response("Telegram update error", { status: 500 });
    }
  }
  return new Response("Not found", { status: 404 });
}
__name(handleTelegram, "handleTelegram");

// ../server/lobbyDirectory.ts
import { DurableObject } from "cloudflare:workers";
var STALE_AFTER_MS = 9e4;
var MAX_TABLES = 150;
function cleanName(input) {
  if (typeof input !== "string") return "\u0421\u0442\u043E\u043B \u0443 \u043A\u0430\u043C\u0438\u043D\u0430";
  return input.trim().replace(/\s+/g, " ").slice(0, 36) || "\u0421\u0442\u043E\u043B \u0443 \u043A\u0430\u043C\u0438\u043D\u0430";
}
__name(cleanName, "cleanName");
var LobbyDirectory = class extends DurableObject {
  static {
    __name(this, "LobbyDirectory");
  }
  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    const previous = await this.ctx.storage.get("tables") || [];
    const tables = previous.filter((room) => now - room.updatedAt < STALE_AFTER_MS && room.seats > 0 || now - room.createdAt < STALE_AFTER_MS && room.seats === 0);
    if (tables.length !== previous.length) await this.ctx.storage.put("tables", tables);
    // Account-bound room lookup. This Durable Object endpoint is internal; the public API verifies Telegram initData first.
    if (url.pathname === "/resume/save" && request.method === "POST") {
      const data = await request.json().catch(() => ({}));
      if (!Number.isSafeInteger(data.telegramId) || data.telegramId <= 0 || typeof data.roomId !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(data.roomId)) return new Response("Invalid", { status: 400 });
      await this.ctx.storage.put("resume:" + data.telegramId, { roomId: data.roomId, updatedAt: now });
      return Response.json({ ok: true });
    }
    if (url.pathname === "/resume/find" && request.method === "POST") {
      const data = await request.json().catch(() => ({}));
      if (!Number.isSafeInteger(data.telegramId) || data.telegramId <= 0) return Response.json({ roomId: null });
      const entry = await this.ctx.storage.get("resume:" + data.telegramId);
      if (!entry || now - entry.updatedAt > 864e5) return Response.json({ roomId: null }, { headers: { "Cache-Control": "no-store" } });
      return Response.json({ roomId: entry.roomId }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/resume/forget" && request.method === "POST") {
      const data = await request.json().catch(() => ({}));
      if (!Number.isSafeInteger(data.telegramId) || typeof data.roomId !== "string") return new Response("Invalid", { status: 400 });
      const key = "resume:" + data.telegramId;
      const entry = await this.ctx.storage.get(key);
      if (entry?.roomId === data.roomId) await this.ctx.storage.delete(key);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/list" && request.method === "GET") {
      const free = tables.filter((t) => t.visibility === "public" && t.phase === "LOBBY" && t.seats > 0 && t.seats < t.capacity).sort((a, b) => b.seats - a.seats || b.updatedAt - a.updatedAt);
      return Response.json({ tables: free.slice(0, 40), updatedAt: now }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/create" && request.method === "POST") {
      if (tables.length >= MAX_TABLES) {
        return Response.json({ error: "\u0412\u0441\u0435 \u0441\u0442\u043E\u043B\u044B \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u0437\u0430\u043D\u044F\u0442\u044B. \u041F\u043E\u0432\u0442\u043E\u0440\u0438 \u043F\u043E\u043F\u044B\u0442\u043A\u0443." }, { status: 429 });
      }
      const data = await request.json().catch(() => ({}));
      const id = "t_" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
      const table = {
        id,
        title: cleanName(data.title),
        visibility: data.visibility === "private" ? "private" : "public",
        underlaidCards: data.underlaidCards !== false,
        phase: "LOBBY",
        seats: 0,
        capacity: 6,
        players: [],
        createdAt: now,
        updatedAt: now
      };
      tables.push(table);
      await this.ctx.storage.put("tables", tables);
      await this.ctx.storage.setAlarm(now + STALE_AFTER_MS);
      return Response.json({ table }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/get" && request.method === "GET") {
      const table = tables.find((t) => t.id === url.searchParams.get("id"));
      return table ? Response.json({ table }) : Response.json({ error: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" }, { status: 404 });
    }
    if (url.pathname === "/sync" && request.method === "POST") {
      const data = await request.json();
      if (!data.id || !/^[a-zA-Z0-9_-]{1,48}$/.test(data.id)) return new Response("Bad room", { status: 400 });
      const index = tables.findIndex((t) => t.id === data.id);
      const current = index >= 0 ? tables[index] : {
        id: data.id,
        title: "\u0421\u0442\u043E\u043B " + data.id.slice(-6),
        visibility: "private",
        phase: "LOBBY",
        seats: 0,
        capacity: 6,
        players: [],
        createdAt: now,
        updatedAt: now
      };
      const connected = Array.isArray(data.players) ? data.players.filter((p) => typeof p === "string" && p.length <= 32).slice(0, 6) : [];
      const next = {
        ...current,
        seats: connected.length,
        players: connected,
        phase: data.phase || current.phase,
        updatedAt: now
      };
      if (index < 0) tables.push(next);
      else tables[index] = next;
      await this.ctx.storage.put("tables", tables);
      await this.ctx.storage.setAlarm(now + STALE_AFTER_MS);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/remove" && request.method === "POST") {
      const { id } = await request.json();
      await this.ctx.storage.put("tables", tables.filter((t) => t.id !== id));
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }
  async alarm() {
    const now = Date.now();
    const tables = await this.ctx.storage.get("tables") || [];
    const alive = tables.filter((t) => now - t.updatedAt < STALE_AFTER_MS && t.seats > 0 || now - t.createdAt < STALE_AFTER_MS && t.seats === 0);
    if (alive.length !== tables.length) await this.ctx.storage.put("tables", alive);
    if (alive.length) await this.ctx.storage.setAlarm(now + 45e3);
  }
};

// ../server/drawReveal.ts
function createDrawReveal(playerId, topBeforeDraw, deckLengthBefore, deckLengthAfter, targetPlayerId) {
  if (!playerId || !topBeforeDraw || deckLengthBefore !== deckLengthAfter + 1) return null;
  return {
    id: crypto.randomUUID(),
    playerId,
    card: { ...topBeforeDraw },
    ...targetPlayerId ? { targetPlayerId } : {},
    createdAt: Date.now()
  };
}
__name(createDrawReveal, "createDrawReveal");

// ../server/visibility.ts
function concealed(id) {
  return { id: "masked-" + id, rank: "6", suit: "clubs" };
}
__name(concealed, "concealed");
function visibleState(state, viewerId) {
  const view = structuredClone(state);
  view.deck = state.deck.map((_, i) => concealed("deck-" + i));
  view.players = view.players.map((player) => {
    const original = state.players.find((p) => p.id === player.id);
    if (player.id !== viewerId) {
      player.hand = original.hand.map((_, i) => concealed("hand-" + i));
    }
    // Each card placed on a pile stays public and face-up throughout every phase. Only the two original underlaid cards remain concealed.
    player.stumps = original.stumps.map((card, i) => i < (state.underlaidCards === false ? 0 : 2) ? concealed("stumps-" + player.id + "-" + i) : card);
    return player;
  });
  return view;
}
__name(visibleState, "visibleState");

// ../server/actionReplay.ts
var MAX_ACTIONS_PER_PLAYER = 96;
var ACTION_ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;
function rememberAction(history, playerId, actionId) {
  if (!ACTION_ID_FORMAT.test(actionId) || !playerId) return false;
  const seen = history[playerId] || [];
  if (seen.includes(actionId)) return false;
  seen.push(actionId);
  if (seen.length > MAX_ACTIONS_PER_PLAYER) {
    seen.splice(0, seen.length - MAX_ACTIONS_PER_PLAYER);
  }
  history[playerId] = seen;
  return true;
}
__name(rememberAction, "rememberAction");
var STATE_CHANGING_ACTIONS = /* @__PURE__ */ new Set([
  "startGame",
  "accusePlayer",
  "finishReview",
  "drawTo",
  "moveTopTo",
  "drawCardFromDeck",
  "takeFromPile",
  "placeActiveCard",
  "givePenaltyCard",
  "playCard",
  "takeTrick",
  "takeStumps",
  "exitGame"
]);

// ../server/cloudflare-worker.ts
function emit(socket, type, data) {
  try {
    socket.send(JSON.stringify({ type, data }));
  } catch {
  }
}
__name(emit, "emit");
async function verifyTelegram(initData, botToken) {
  if (!botToken || initData.length > 8192) return null;
  try {
    const params = new URLSearchParams(initData);
    const authDate = Number(params.get("auth_date"));
    const hash = params.get("hash") || "";
    if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
    const now = Math.floor(Date.now() / 1e3);
    if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) return null;
    const check = [...params.entries()].filter(([k]) => k !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
    const enc = new TextEncoder();
    const key1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const secret = await crypto.subtle.sign("HMAC", key1, enc.encode(botToken));
    const key2 = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key2, enc.encode(check)));
    const expected = new Uint8Array(hash.match(/../g).map((x) => parseInt(x, 16)));
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    if (diff !== 0) return null;
    const user = JSON.parse(params.get("user") || "{}");
    return Number.isSafeInteger(user.id) && user.id > 0 ? user : null;
  } catch {
    return null;
  }
}
__name(verifyTelegram, "verifyTelegram");
var PidorRoom = class extends DurableObject2 {
  static {
    __name(this, "PidorRoom");
  }
  game = new PidorGame([]);
  sessions = {};
  botIds = [];
  roomMode = "friends";
  roomId = "";
  idleDeadline = 0;
  processedActions = {};
  lastPresenceSignature = "";
  lastDirectoryHeartbeatAt = 0;

  // P34: server-authoritative turn clock; independent FSM from the game-phase FSM.
  clockEdges={IDLE:["RUNNING","PAUSED"],RUNNING:["PAUSED","EXPIRED","IDLE"],PAUSED:["RUNNING","IDLE"],EXPIRED:["RUNNING","PAUSED","IDLE"]};
  // Single authorization gate for ALL outbound realtime events.
  isCurrentSocket(socket){
    if(socket.readyState!==WebSocket.OPEN)return false;
    const attachment=socket.deserializeAttachment()||{};
    if(!attachment.playerId)return false;
    const session=Object.values(this.sessions).find(s=>s.playerId===attachment.playerId);
    return !!session&&(!session.connectionGeneration||session.connectionGeneration===attachment.generation);
  }
  turnOwner(){
    const s=this.game.state;
    if(s.phase==="DEALING")return Date.now()<(s.firstTurnReadyAt||s.initialDealEndsAt||0)||!s.deck.length&&!s.activeCard?null:s.activeCard?.ownerId||s.players[s.turnIndex]?.id;
    if(s.phase==="PENALTY_DISTRIBUTION")return null;
    if(s.phase==="MAIN_GAME")return s.players[s.turnIndex]?.id;
    return null;
  }
  connected(id,now=Date.now()){
    const p=this.game.state.players.find(p=>p.id===id);
    if(!p||p.hasExited)return false;if(p.isBot)return true;
    const gen=Object.values(this.sessions).find(s=>s.playerId===id)?.connectionGeneration;
    return this.ctx.getWebSockets().some(ws=>{const a=ws.deserializeAttachment()||{};return ws.readyState===WebSocket.OPEN&&a.playerId===id&&(!gen||gen===a.generation)&&a.visible!==false&&Number(a.lastSeenAt)>now-9000});
  }
  presenceSignature(){return this.game.state.players.map(p=>p.id+":"+(this.connected(p.id)?"1":"0")).join("|")}
  broadcastPresence(){const sig=this.presenceSignature();if(sig===this.lastPresenceSignature)return;this.lastPresenceSignature=sig;this.broadcast()}
  heartbeat(socket,visible){const a=socket.deserializeAttachment()||{};const session=Object.values(this.sessions).find(s=>s.playerId===a.playerId);if(!session||session.connectionGeneration&&session.connectionGeneration!==a.generation)return false;socket.serializeAttachment({...a,lastSeenAt:Date.now(),visible:visible===undefined?a.visible!==false:visible!==false});return true}
  syncTurnClock(reset=false){
    const s=this.game.state,now=Date.now(),id=this.turnOwner(),p=s.players.find(p=>p.id===id),actor=p&&!p.hasExited&&(s.phase==="MAIN_GAME"||!p.isBot)?id:null;
    const c=s.turnClock||{status:"IDLE",actorId:null,phase:null,deadlineAt:0},was=c.status;let next=c;
    if(!actor){if(was!=="IDLE")next={status:"IDLE",actorId:null,phase:null,deadlineAt:0}}
    else if(reset||c.actorId!==actor||c.phase!==s.phase||was==="IDLE"){
      const online=this.connected(actor,now);next={status:online?"RUNNING":"PAUSED",actorId:actor,phase:s.phase,deadlineAt:online?now+15000:0};
    }else if(was==="RUNNING"){
      if(!this.connected(actor,now))next={...c,status:"PAUSED",deadlineAt:0};
      else if(now>=c.deadlineAt){next={...c,status:"EXPIRED",deadlineAt:0};if(s.phase==="DEALING"){p.penalties++;this.game.endPenalizedTurn(actor);this.game.onPenalty?.(actor,"15 секунд на ход истекли",null)}else if(s.phase==="MAIN_GAME")this.game.endPenalizedTurn(actor)}
    }else if(was==="PAUSED"&&this.connected(actor,now))next={...c,status:"RUNNING",deadlineAt:now+15000};
    if(next===c)return false;
    if(was!==next.status&&!this.clockEdges[was]?.includes(next.status))throw Error("Invalid clock FSM "+was+"->"+next.status);
    s.turnClock=next;return true;
  }
  clockAlarmAt(){const c=this.game.state.turnClock;if(c?.status!=="RUNNING")return 0;let at=c.deadlineAt;const session=Object.values(this.sessions).find(s=>s.playerId===c.actorId);for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment()||{};if(ws.readyState===WebSocket.OPEN&&a.playerId===c.actorId&&(!session?.connectionGeneration||session.connectionGeneration===a.generation)&&a.visible!==false&&a.lastSeenAt)at=Math.min(at,a.lastSeenAt+9001)}return Math.max(Date.now()+30,at)}
  // Turn clock restarts only when the actual turn changes, never after each card or drag.
  turnStamp(){const s=this.game.state;return JSON.stringify([s.phase,s.turnIndex,s.phase==="DEALING"?(s.dealingTurnSerial||0):0])}
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const [snapshot, sessions, bots, mode, roomId, idleDeadline, processedActions] = await Promise.all([
        ctx.storage.get("game"),
        ctx.storage.get("sessions"),
        ctx.storage.get("bots"),
        ctx.storage.get("roomMode"),
        ctx.storage.get("roomId"),
        ctx.storage.get("idleDeadline"),
        ctx.storage.get("processedActions")
      ]);
      if (snapshot) this.game.restore(snapshot);
      if (sessions) this.sessions = sessions;
      if (bots) this.botIds = bots;
      if (mode) this.roomMode = mode;
      if (roomId) this.roomId = roomId;
      if (idleDeadline) this.idleDeadline = idleDeadline;
      if (processedActions) this.processedActions = processedActions;
    });
    this.game.onPenalty = (playerId, reason, reporterId=null) => {
      const reporter=this.game.state.players.find(p=>p.id===reporterId);
      const owner=this.game.state.players.find(p=>p.id===playerId);
      const source=reason.startsWith("6♠:")?"spade_six":reporter?"accusation":"timer";
      const payload={playerId,reason,reporterId:reporter?.id||null,reporterName:reporter?.name||(source==="spade_six"?"6♠":"Таймер"),at:Date.now()};
      const log=Array.isArray(this.game.state.penaltyLog)?this.game.state.penaltyLog:[];
      this.game.state.penaltyLog=[...log.slice(-79),{id:crypto.randomUUID(),at:payload.at,phase:this.game.state.phase,playerId,playerName:owner?.name||"Игрок",reason:String(reason),reporterId:reporter?.id||null,reporterName:reporter?.name||null,source}];
      for(const socket of this.ctx.getWebSockets()){
        if(!this.isCurrentSocket(socket))continue;
        emit(socket,"penalty",payload);
        if(socket.deserializeAttachment()?.playerId===playerId)emit(socket,"penaltyAwarded",payload);
      }
    };
  }
  async fetch(request) {
    const id = new URL(request.url).searchParams.get("room");
    if (id && /^[A-Za-z0-9_-]{1,48}$/.test(id) && id !== this.roomId) {
      this.roomId = id;
      await this.ctx.storage.put("roomId", id);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({});
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcastDrawReveal(event) {
    for(const socket of this.ctx.getWebSockets())
      if(this.isCurrentSocket(socket))emit(socket,"cardDrawReveal",event);
  }
  broadcast() {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment();
      const playerId = attachment?.playerId;
      if (playerId) {
        const session = Object.values(this.sessions).find(s => s.playerId === playerId);
        if (!session || session.connectionGeneration && session.connectionGeneration !== attachment.generation) continue;
        const view = visibleState(this.game.state, playerId);
        view.hostId = this.currentHostId();
        view.players.forEach(p=>{p.connectionState=this.connected(p.id)?"online":"offline"});
        if (this.game.state.phase === "PENALTY_DISTRIBUTION") {
          view.pendingPenaltyDebts = this.game.snapshot().penaltyDebts;
          view.pendingPenaltyTurn = this.game.currentPenaltyTurn();
        }
        emit(socket, "gameStateUpdate", view);
      }
    }
  }
  currentHostId() {
    const active = new Set(this.activePlayerIds());
    return this.game.state.players.find((p) => active.has(p.id) && !p.isBot)?.id;
  }
  async forgetLobbySeat(socket) {
    if (this.game.state.phase !== "LOBBY") return;
    const id = socket.deserializeAttachment()?.playerId;
    if (!id || this.activePlayerIds(socket).includes(id)) return;
    // A closed Telegram WebView is not a deliberate leave: keep the seat for ten minutes.
    const session = Object.values(this.sessions).find((entry) => entry.playerId === id);
    if (session) { session.disconnectedAt = Date.now(); await this.ctx.storage.put("sessions", this.sessions); }
  }
  async pruneOfflineLobbySeats() {
    if (this.game.state.phase !== "LOBBY") return;
    const active = new Set(this.activePlayerIds());
    const cutoff = Date.now() - 10 * 60e3;
    let changed = false;
    for (const [token, session] of Object.entries(this.sessions)) {
      if (!active.has(session.playerId) && session.disconnectedAt && session.disconnectedAt <= cutoff) {
        this.game.state.players = this.game.state.players.filter((player) => player.id !== session.playerId);
        delete this.sessions[token];
        if (session.telegramId && this.roomId) {
          try {
            await this.env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/resume/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramId: session.telegramId, roomId: this.roomId }) });
          } catch {}
        }
        changed = true;
      }
    }
    if (changed) {
      await this.ctx.storage.put("sessions", this.sessions);
      await this.saveGame();
      this.broadcast();
      await this.reportRoom();
    }
  }
  activePlayerIds(exclude){
    const ids=new Set();
    for(const ws of this.ctx.getWebSockets()){
      if(ws===exclude||ws.readyState!==WebSocket.OPEN)continue;
      const a=ws.deserializeAttachment()||{},id=a.playerId;
      if(!id)continue;
      const session=Object.values(this.sessions).find(s=>s.playerId===id);
      if(!session||session.connectionGeneration&&session.connectionGeneration!==a.generation)continue;
      ids.add(id);
    }
    return [...ids];
  }
  async reportRoom() {
    if (!this.roomId || this.roomMode === "bot") return;
    const ids = new Set(this.activePlayerIds());
    const players = this.game.state.players.filter((p) => ids.has(p.id)).map((p) => p.name);
    try {
      await this.env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: this.roomId, players, phase: this.game.state.phase })
      });
    } catch (e) {
      console.warn("Lobby sync error", String(e).slice(0, 150));
    }
  }
  async clearVacantRoom() {
    if (this.activePlayerIds().length > 0) return;
    if (this.roomId) {
      try {
        await this.env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: this.roomId })
        });
      } catch (e) {
        console.warn("Lobby cleanup error", String(e).slice(0, 150));
      }
    }
    // Forget the Telegram room index only if it still points to this room.
    if (this.roomId) for (const telegramId of new Set(Object.values(this.sessions).map((s) => s.telegramId).filter((id) => Number.isSafeInteger(id) && id > 0))) {
      try { await this.env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/resume/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramId, roomId: this.roomId }) }); } catch {}
    }
    const penaltyCallback = this.game.onPenalty;
    this.game = new PidorGame([]);
    this.game.onPenalty = penaltyCallback;
    this.sessions = {};
    this.botIds = [];
    this.roomMode = "friends";
    this.idleDeadline = 0;
    this.processedActions = {};
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  async markActivity() {
    if (this.activePlayerIds().length) {
      if (this.idleDeadline) {
        this.idleDeadline = 0;
        await this.ctx.storage.delete("idleDeadline");
      }
    } else {
      this.idleDeadline = Date.now() + (this.game.state.phase === "LOBBY" ? 10 * 60e3 : 24 * 60 * 60e3);
      await this.ctx.storage.put("idleDeadline", this.idleDeadline);
    }
    await this.driveBots();
  }
  async saveGame(){
    const errors=this.game.auditIntegrity();
    if(errors.length){
      console.error("[PIDOR INTEGRITY]",this.roomId,this.game.state.phase,errors.join(";"));
      const previous=await this.ctx.storage.get("game");
      if(previous){
        this.game.restore(structuredClone(previous));
        this.syncTurnClock();
        for(const ws of this.ctx.getWebSockets())if(ws.readyState===WebSocket.OPEN&&ws.deserializeAttachment()?.playerId)
          emit(ws,"actionError","Состояние партии восстановлено после сбоя. Повтори действие.");
        this.broadcast();
      }
      return false;
    }
    await Promise.all([this.ctx.storage.put("game",this.game.snapshot()),this.ctx.storage.put("processedActions",this.processedActions)]);
    return true;
  }
  broadcastVerdict(accuserId, verdict) {
    for(const socket of this.ctx.getWebSockets())
      if(this.isCurrentSocket(socket))emit(socket,"accusationVerdict",{accuserId,...verdict});
  }
  announcePenaltyCard(receiverId,giverId){
    for(const socket of this.ctx.getWebSockets())
      if(this.isCurrentSocket(socket)&&socket.deserializeAttachment()?.playerId===receiverId)
        emit(socket,"penaltyCardReceived",{giverId});
  }
  async driveBots() {
    const phaseChanged=this.game.reconcilePhase(),clockChanged=this.syncTurnClock();
    if(phaseChanged||clockChanged){await this.saveGame();this.broadcast()}
    if(this.game.state.phase==="DEALING"){
      const ready=this.game.state.firstTurnReadyAt||this.game.state.firstTurnSpinEndsAt||this.game.state.initialDealEndsAt||0;
      if(ready&&Date.now()<ready){await this.ctx.storage.setAlarm(ready);return}
    }
    if (this.idleDeadline && this.activePlayerIds().length === 0) {
      await this.ctx.storage.setAlarm(this.idleDeadline);
      return;
    }
    if (this.game.state.phase === "LOBBY") {
      const pending = Object.values(this.sessions).filter((s) => s.disconnectedAt).map((s) => s.disconnectedAt + 10 * 60e3);
      if (pending.length) { await this.ctx.storage.setAlarm(Math.max(Date.now() + 1e3, Math.min(...pending))); return; }
    }
    if (this.game.state.phase === "PENALTY_REVIEW" && this.game.reviewDeadlineAt) {
      await this.ctx.storage.setAlarm(this.game.reviewDeadlineAt);
      return;
    }
    const clockAt=this.clockAlarmAt();
    const botAt=this.roomMode==="bot"&&nextBotMove(this.game,this.botIds)?Date.now()+1550:0;
    const alarmAt=clockAt&&botAt?Math.min(clockAt,botAt):clockAt||botAt;
    if(alarmAt)await this.ctx.storage.setAlarm(alarmAt);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const phaseChanged=this.game.reconcilePhase(),clockChanged=this.syncTurnClock();
    if(phaseChanged||clockChanged){await this.saveGame();this.broadcast()}
    this.broadcastPresence();
    if(this.game.state.phase==="DEALING"){
      const ready=this.game.state.firstTurnReadyAt||this.game.state.firstTurnSpinEndsAt||this.game.state.initialDealEndsAt||0;
      if(ready&&Date.now()<ready){await this.ctx.storage.setAlarm(ready);return}
    }
    if (this.idleDeadline && this.activePlayerIds().length === 0) {
      if (Date.now() >= this.idleDeadline) await this.clearVacantRoom();
      else await this.ctx.storage.setAlarm(this.idleDeadline);
      return;
    }
    if (this.game.state.phase === "LOBBY") {
      await this.pruneOfflineLobbySeats();
      await this.driveBots();
      return;
    }
    if (this.game.expireReview()) {
      await this.saveGame();
      this.broadcast();
      await this.driveBots();
      return;
    }
    if(this.roomMode!=="bot"){await this.driveBots();return}
    const move = nextBotMove(this.game, this.botIds);
    if (!move) {
      await this.driveBots();
      return;
    }
    const drawBefore = move.type === "drawCardFromDeck" ? this.game.state.deck.length : 0;
    const drawnTop = move.type === "drawCardFromDeck" ? this.game.state.deck[drawBefore - 1] : void 0;
    const verdict = move.type === "accuse" ? this.game.accuse(move.actorId, move.accusedId) : null;
    const applied = move.type === "accuse" ? verdict !== null : applyBotMove(this.game, move);
    if (applied) {
      if (move.type === "drawCardFromDeck") {
        const reveal = createDrawReveal(move.actorId, drawnTop, drawBefore, this.game.state.deck.length);
        if (reveal) this.broadcastDrawReveal(reveal);
      }
      if (verdict) this.broadcastVerdict(move.actorId, verdict);
      if (move.type === "givePenaltyCard") this.announcePenaltyCard(move.receiverId, move.actorId);
      await this.saveGame();
      this.broadcast();
    } else {
      console.warn("Bot move rejected", move.type, this.game.state.phase);
    }
    await this.driveBots();
  }
  async join(socket, payload) {
    const tgData = typeof payload.initData === "string" ? payload.initData : "";
    const telegram = tgData ? await verifyTelegram(tgData, this.env.TELEGRAM_BOT_TOKEN) : null;
    if (tgData && !telegram) return emit(socket, "joinError", "Telegram: \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430");
    const rawName = telegram ? telegram.first_name || telegram.username : payload.playerName;
    if (typeof rawName !== "string" || !rawName.trim() || rawName.length > 32) {
      return emit(socket, "joinError", "\u0412\u0432\u0435\u0434\u0438 \u0438\u043C\u044F \u043E\u0442 1 \u0434\u043E 32 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432");
    }
    const existingToken = typeof payload.sessionToken === "string" ? payload.sessionToken : "";
    let session = existingToken ? this.sessions[existingToken] : void 0;
    if (session && session.telegramId !== void 0 && session.telegramId !== telegram?.id) {
      return emit(socket, "joinError", "\u0421\u0435\u0441\u0441\u0438\u044F \u043F\u0440\u0438\u043D\u0430\u0434\u043B\u0435\u0436\u0438\u0442 \u0434\u0440\u0443\u0433\u043E\u043C\u0443 \u0438\u0433\u0440\u043E\u043A\u0443 Telegram");
    }
    let token = existingToken;
    // Signed Telegram identity restores the original seat even if WebView localStorage was cleared.
    if (!session && telegram?.id) {
      const match = Object.entries(this.sessions).find(([, value]) => value.telegramId === telegram.id && this.game.state.players.some((player) => player.id === value.playerId));
      if (match) { token = match[0]; session = match[1]; }
    }
    if (!session && payload.resume === true) return emit(socket, "joinError", "Сохранённая партия больше не доступна. Создай новую комнату.");
    let createdBotRoom = false;
    if (!session && this.game.state.phase !== "LOBBY" && this.activePlayerIds(socket).length === 0 && (!this.idleDeadline || Date.now() >= this.idleDeadline)) {
      await this.clearVacantRoom();
    }
    if (!session) {
      if (this.game.state.players.length === 0) {
        let useBase = payload.underlaidCards !== false;
        if (payload.mode !== "bot" && this.roomId) {
          try {
            const response = await this.env.LOBBY.getByName("public-tables").fetch(
              "https://lobby.internal/get?id=" + encodeURIComponent(this.roomId)
            );
            if (response.ok) {
              const record = await response.json();
              useBase = record.table?.underlaidCards !== false;
            }
          } catch {
          }
        }
        this.game.state.underlaidCards = useBase;
      }
      if (this.roomMode === "bot" && this.game.state.players.length) {
        return emit(socket, "joinError", "\u042D\u0442\u043E \u043E\u0434\u0438\u043D\u043E\u0447\u043D\u0430\u044F \u0438\u0433\u0440\u0430. \u0421\u043E\u0437\u0434\u0430\u0439 \u0441\u0432\u043E\u044E \u043A\u043E\u043C\u043D\u0430\u0442\u0443 \u0441 \u0431\u043E\u0442\u043E\u043C.");
      }
      if (this.game.state.phase !== "LOBBY") return emit(socket, "joinError", "\u041F\u0430\u0440\u0442\u0438\u044F \u0443\u0436\u0435 \u0438\u0434\u0451\u0442 \u2014 \u043F\u0440\u0438\u0441\u043E\u0435\u0434\u0438\u043D\u0438\u0442\u044C\u0441\u044F \u043D\u0435\u043B\u044C\u0437\u044F");
      if (this.game.state.players.length >= 6) return emit(socket, "joinError", "\u041A\u043E\u043C\u043D\u0430\u0442\u0430 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0430");
      token = crypto.randomUUID();
      session = { playerId: crypto.randomUUID(), name: rawName.trim(), telegramId: telegram?.id };
      this.sessions[token] = session;
      this.game.state.players.push({
        id: session.playerId,
        name: session.name,
        hand: [],
        stumps: [],
        penalties: 0,
        isReady: false,
        onDuty: false,
        hasExited: false
      });
      if (this.game.state.players.length === 1 && payload.mode === "bot") {
        this.roomMode = "bot";
        createdBotRoom = true;
        const requested = typeof payload.botCount === "number" ? payload.botCount : 1;
        const count = Math.max(1, Math.min(5, Math.floor(requested || 1)));
        for (let n = 0; n < count; n++) {
          const id = "bot-" + crypto.randomUUID();
          this.botIds.push(id);
          this.game.state.players.push({
            id,
            name: count === 1 ? "\u0411\u043E\u0442 \u0412\u0430\u043B\u0435\u0442" : "\u0411\u043E\u0442 " + (n + 1),
            hand: [],
            stumps: [],
            penalties: 0,
            isReady: true,
            onDuty: false,
            hasExited: false,
            isBot: true
          });
        }
      }
      this.game.state.mode = this.roomMode;
      await Promise.all([
        this.ctx.storage.put("sessions", this.sessions),
        this.ctx.storage.put("bots", this.botIds),
        this.ctx.storage.put("roomMode", this.roomMode)
      ]);
      await this.saveGame();
    }
    // A new websocket must fence out the previous connection before it can mutate the seat.
    session.connectionGeneration = (session.connectionGeneration || 0) + 1;
    socket.serializeAttachment({ playerId: session.playerId, generation: session.connectionGeneration,lastSeenAt:Date.now(),visible:true });
    await this.ctx.storage.put("sessions", this.sessions);
    for (const other of this.ctx.getWebSockets()) {
      if (other !== socket && other.deserializeAttachment()?.playerId === session.playerId) {
        other.close(1e3, "Reconnected in another tab");
      }
    }
    if (session.disconnectedAt) { delete session.disconnectedAt; await this.ctx.storage.put("sessions", this.sessions); }
    this.idleDeadline = 0;
    await this.ctx.storage.delete("idleDeadline");
    emit(socket, "joined", { playerId: session.playerId, sessionToken: token, name: session.name });
    if (telegram?.id && this.roomId) {
      try {
        await this.env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/resume/save", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramId: telegram.id, roomId: this.roomId })
        });
      } catch (err) { console.warn("Resume directory sync failed", String(err).slice(0, 120)); }
    }
    if (createdBotRoom) {
      this.game.start();
      await this.saveGame();
    }
    this.syncTurnClock();
    await this.saveGame();
    this.broadcast();
    this.lastPresenceSignature=this.presenceSignature();
    await this.reportRoom();
    await this.driveBots();
  }
  async webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > 8192) return;
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const type = parsed.type;
    const data = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
    if (type === "joinRoom") {
      await this.join(socket, data);
      return;
    }
    if(type==="ping"||type==="presence"){
      const attachment=socket.deserializeAttachment()||{};
      const session=Object.values(this.sessions).find(s=>s.playerId===attachment.playerId);
      if(!session||(session.connectionGeneration&&session.connectionGeneration!==attachment.generation)||socket.readyState!==WebSocket.OPEN)return;
      const before=this.syncTurnClock();
      const authorized=this.heartbeat(socket,data.visible);
      const after=this.syncTurnClock();
      if(before||after){await this.saveGame();this.broadcast();await this.driveBots()}
      else if(authorized)this.broadcastPresence();
      if(type==="ping"){emit(socket,"pong",Date.now());if(authorized&&Date.now()-this.lastDirectoryHeartbeatAt>=20000){this.lastDirectoryHeartbeatAt=Date.now();await this.reportRoom()}}
      return;
    }
    const id = socket.deserializeAttachment()?.playerId;
    if (!id || !this.game.state.players.some((p) => p.id === id)) {
      return emit(socket, "joinError", "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0441\u044C \u043A \u043A\u043E\u043C\u043D\u0430\u0442\u0435");
    }
    const session = Object.values(this.sessions).find(s => s.playerId === id);
    if (!session || (session.connectionGeneration && session.connectionGeneration !== socket.deserializeAttachment()?.generation) || socket.readyState !== WebSocket.OPEN) {
      return emit(socket, "actionError", "Управление партией передано другому окну");
    }
    const game = this.game;
    const preClockChanged=this.syncTurnClock(),preStamp=this.turnStamp(),preOwner=this.turnOwner();
    this.heartbeat(socket,true);
    const resumedClock=this.syncTurnClock();
    if(preClockChanged||resumedClock){await this.saveGame();this.broadcast()}
    if (game.state.phase === "DEALING" && (game.state.firstTurnReadyAt || game.state.firstTurnSpinEndsAt || game.state.initialDealEndsAt) && Date.now() < (game.state.firstTurnReadyAt || game.state.firstTurnSpinEndsAt || game.state.initialDealEndsAt) && ["drawTo", "moveTopTo", "drawCardFromDeck", "takeFromPile", "placeActiveCard"].includes(type || "")) {
      return emit(socket, "actionError", "\u0418\u0434\u0451\u0442 \u043D\u0430\u0447\u0430\u043B\u044C\u043D\u0430\u044F \u0440\u0430\u0437\u0434\u0430\u0447\u0430");
    }
    if(type&&STATE_CHANGING_ACTIONS.has(type)){
      if (typeof data.actionId !== "string" || !rememberAction(this.processedActions, id, data.actionId)) {
        return emit(socket, "actionError", "\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0435 \u0438\u043B\u0438 \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435");
      }
    }
    if (type === "accusePlayer" && typeof data.accusedId === "string") {
      const verdict = game.accuse(id, data.accusedId);
      console.info("[PIDOR-ACCUSATION]", verdict ? verdict.correct ? "confirmed" : "false-call" : "rejected", game.state.phase);
      if (verdict) this.broadcastVerdict(id, verdict);
      else emit(socket, "actionError", "\u041E\u0431\u0432\u0438\u043D\u0435\u043D\u0438\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E");
    } else if (type === "finishReview") {
      if (!game.finishReview(id)) emit(socket, "actionError", "\u0420\u0430\u0437\u0431\u043E\u0440 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D");
    } else if (type === "startGame") {
      if (game.state.phase !== "LOBBY" || game.state.players.length < 2 || this.activePlayerIds().length < 2) {
        emit(socket, "actionError", "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0438\u0433\u0440\u043E\u043A\u043E\u0432 \u0438\u043B\u0438 \u043F\u0430\u0440\u0442\u0438\u044F \u0443\u0436\u0435 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C");
      } else if (this.currentHostId() !== id) {
        emit(socket, "actionError", "\u041F\u0430\u0440\u0442\u0438\u044E \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442 \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u0441\u0442\u043E\u043B\u0430");
      } else game.start();
    } else if (type === "drawTo" && typeof data.targetPlayerId === "string") {
      const before = game.state.deck.length;
      const card = game.state.deck[before - 1];
      game.drawTo(id, data.targetPlayerId);
      const reveal = createDrawReveal(id, card, before, game.state.deck.length, data.targetPlayerId);
      if (reveal) this.broadcastDrawReveal(reveal);
    } else if (type === "moveTopTo" && typeof data.targetPlayerId === "string") {if(!game.moveTopTo(id,data.targetPlayerId))emit(socket,"actionError","Этот переброс запрещён правилами ранга или очередности.")}
    else if (type === "drawCardFromDeck") {
      const before = game.state.deck.length;
      const card = game.state.deck[before - 1];
      game.takeFromDeck(id);
      const reveal = createDrawReveal(id, card, before, game.state.deck.length);
      if (reveal) this.broadcastDrawReveal(reveal);
    } else if (type === "takeFromPile" && typeof data.cardId === "string") game.takeFromPile(id, data.cardId);
    else if (type === "placeActiveCard" && typeof data.targetPlayerId === "string") {if(!game.placeActiveCard(id,data.targetPlayerId))emit(socket,"actionError","Неверный переброс: соблюдай ранг и порядок игроков.")}
    else if (type === "givePenaltyCard" && typeof data.cardId === "string" && typeof data.receiverId === "string") {
      if (game.givePenaltyCard(id, data.cardId, data.receiverId)) {
        this.announcePenaltyCard(data.receiverId, id);
      }
    } else if (type === "playCard" && typeof data.cardId === "string") {if(!game.playCard(id,data.cardId))emit(socket,"actionError","Недопустимый ход. Сейчас можно играть только в свой ход и по правилам масти, ранга и козыря.")}
    else if (type === "takeTrick") game.takeTrick(id);
    else if (type === "takeStumps") game.takeStumps(id);
    else if (type === "exitGame") game.exitGame(id);
    else if (type === "sayPhrase" && typeof data.phrase === "string" && data.phrase.length <= 120) {
      for(const other of this.ctx.getWebSockets())if(this.isCurrentSocket(other))emit(other,"playerMessage",{playerId:id,message:data.phrase});
      return;
    } else return;
    if(preOwner===id&&["drawCardFromDeck","drawTo","moveTopTo","takeFromPile","placeActiveCard","givePenaltyCard","playCard","takeTrick","takeStumps","exitGame"].includes(type)&&preStamp!==this.turnStamp())this.syncTurnClock(true);
    else this.syncTurnClock();
    await this.saveGame();
    this.broadcast();
    this.lastPresenceSignature=this.presenceSignature();
    if (type === "startGame" || type === "exitGame") await this.reportRoom();
    await this.driveBots();
  }
  async webSocketClose(socket, code, reason) {
    try {
      socket.close(code, reason);
    } catch {
    }
    await this.forgetLobbySeat(socket);
    this.syncTurnClock();
    await this.saveGame();
    this.broadcastPresence();
    await this.reportRoom();
    await this.markActivity();
  }
  async webSocketError(socket) {
    try {
      socket.close(1011, "WebSocket error");
    } catch {
    }
    await this.forgetLobbySeat(socket);
    this.syncTurnClock();
    await this.saveGame();
    this.broadcastPresence();
    await this.reportRoom();
    await this.markActivity();
  }
};
// PIDOR ONLINE P3/P4 frontend release: same-origin /api/app, safe for legacy assets.
const RELEASE_HTML = "<!doctype html>\n<html lang=\"ru\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=5.0\" />\n  <meta name=\"theme-color\" content=\"#0b1718\" />\n  <meta name=\"description\" content=\"PIDOR ONLINE — карточная игра на 36 карт для друзей и ботов в Telegram.\" />\n  <link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2315352d'/%3E%3Ctext x='32' y='46' font-size='43' font-weight='bold' text-anchor='middle' fill='%23e9bd79'%3EP%3C/text%3E%3C/svg%3E\" />\n  <title>PIDOR ONLINE — Карточная игра</title>\n  <script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n  <script>(function(){var t=window.Telegram&&window.Telegram.WebApp;if(t&&t.platform&&t.platform!==\"unknown\"){document.documentElement.classList.add(\"pidor-telegram\");document.addEventListener(\"dblclick\",function(e){e.preventDefault()},{capture:true,passive:false})}})();</script>\n  <script type=\"module\" src=\"/api/app.js?release=p46-stability\"></script>\n  <link rel=\"stylesheet\" href=\"/api/app.css?release=p46-stability\">\n</head>\n<body>\n  <div id=\"app\"></div>\n</body>\n</html>\n";
const RELEASE_JS = __PIDOR_JS__;
const RELEASE_CSS = __PIDOR_CSS__;
var cloudflare_worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Single canonical Mini App entry point: legacy / must never show the old UI.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // Render the same Mini App directly. Redirects can keep an older
      // Telegram WebView document alive while navigating between screens.
      return new Response(RELEASE_HTML, {headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0, must-revalidate",
        "x-pidor-ui": "telegram-mini-app"
      }});
    }
    if (url.pathname === "/api/app" || url.pathname === "/api/app/") return new Response(RELEASE_HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-pidor-release":"p59"}});
    if (url.pathname === "/api/app.js") return new Response(RELEASE_JS,{headers:{"content-type":"application/javascript; charset=utf-8","cache-control":"no-store"}});
    if (url.pathname === "/api/app.css") return new Response(RELEASE_CSS,{headers:{"content-type":"text/css; charset=utf-8","cache-control":"no-store"}});
    if (url.pathname === "/api/app/meta") return Response.json({release:"P59",ui:"telegram",backend:"v181",deployed:"2026-11-14"});
    if (url.pathname.startsWith("/telegram/")) return handleTelegram(request, env);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "pidor" });
    if (url.pathname === "/api/rooms") {
      const directory = env.LOBBY.getByName("public-tables");
      if (request.method === "GET") return directory.fetch("https://lobby.internal/list");
      if (request.method === "POST") {
        if (Number(request.headers.get("content-length") || 0) > 1024) return new Response("Payload too large", { status: 413 });
        const body = await request.text();
        if (body.length > 1024) return new Response("Payload too large", { status: 413 });
        return directory.fetch("https://lobby.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body
        });
      }
      return new Response("Method not allowed", { status: 405 });
    }
    if (url.pathname === "/api/resume-room" && request.method === "POST") {
      if (Number(request.headers.get("content-length") || 0) > 9000) return new Response("Payload too large", { status: 413 });
      const body = await request.text();
      if (body.length > 9000) return new Response("Payload too large", { status: 413 });
      let data;
      try { data = JSON.parse(body || "{}"); } catch { return Response.json({ roomId: null }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
      const telegram = typeof data.initData === "string" ? await verifyTelegram(data.initData, env.TELEGRAM_BOT_TOKEN) : null;
      if (!telegram) return Response.json({ roomId: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
      return env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/resume/find", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramId: telegram.id })
      });
    }
    if (url.pathname === "/api/room" && request.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) return new Response("Bad id", { status: 400 });
      return env.LOBBY.getByName("public-tables").fetch("https://lobby.internal/get?id=" + encodeURIComponent(id));
    }
    if (url.pathname === "/ws") {
      const room = url.searchParams.get("room") || "";
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(room)) return new Response("Invalid room", { status: 400 });
      return env.ROOMS.getByName("room:" + room).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  LobbyDirectory,
  PidorRoom,
  cloudflare_worker_default as default
};
//# sourceMappingURL=cloudflare-worker.js.map