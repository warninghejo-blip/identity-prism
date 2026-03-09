/**
 * Text Quest Engine — SR2-inspired branching narrative quests.
 * JSON state graph with choices, variables, skillChecks, multiple endings.
 */

import type { ShipStats } from '@/lib/shipStats';

// ── Types ──

export interface QuestChoice {
  text: string;
  nextNode: string;
  condition?: { variable: string; op: '>=' | '<=' | '=='; value: number };
  skillCheck?: { stat: keyof ShipStats; min: number };
  effects?: { variable: string; op: '+' | '-' | '='; value: number }[];
}

export interface QuestNode {
  id: string;
  text: string;
  image?: string;   // emoji icon
  choices: QuestChoice[];
  isEnding?: boolean;
  reward?: { coins: number; xp?: number };
}

export interface TextQuest {
  id: string;
  title: string;
  description: string;
  image: string;    // emoji
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedTime: string;
  nodes: Record<string, QuestNode>;
  startNode: string;
  variables: Record<string, number>;
}

export interface QuestSaveState {
  questId: string;
  currentNode: string;
  variables: Record<string, number>;
  choices: string[];
  completed: boolean;
  endingId?: string;
  reward?: { coins: number };
  completedAt?: string;
}

// ── Quest Data ──

const QUEST_ABANDONED_STATION: TextQuest = {
  id: 'abandoned_station',
  title: 'Abandoned Station',
  description: 'An abandoned space station drifts in the void. Sensors detect faint power signatures inside.',
  image: '🛸',
  difficulty: 'easy',
  estimatedTime: '3-5 min',
  startNode: 'start',
  variables: { cargo: 0, trust: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'Your scanners pick up an abandoned space station orbiting a dead star. Emergency lights flicker weakly through the viewport. Sensors show no life signs, but energy readings are unstable. The docking port appears functional.',
      image: '🛸',
      choices: [
        { text: 'Dock and investigate', nextNode: 'dock' },
        { text: 'Scan from outside first', nextNode: 'scan' },
        { text: 'Too risky — fly away', nextNode: 'leave_early' },
      ],
    },
    scan: {
      id: 'scan',
      text: 'Long-range scans reveal three zones: a cargo bay with sealed containers, a bridge with active computers, and a mysterious sealed section emitting energy spikes. No hostile signatures detected.',
      image: '📡',
      choices: [
        { text: 'Dock and head to cargo bay', nextNode: 'cargo_bay', effects: [{ variable: 'trust', op: '+', value: 1 }] },
        { text: 'Dock and head to bridge', nextNode: 'bridge' },
      ],
    },
    dock: {
      id: 'dock',
      text: 'Docking clamps engage with a metallic screech. The airlock hisses open. Inside, emergency lights cast long shadows. You see corridors leading to the cargo bay and the bridge.',
      image: '🚪',
      choices: [
        { text: 'Go to cargo bay', nextNode: 'cargo_bay' },
        { text: 'Go to bridge', nextNode: 'bridge' },
      ],
    },
    cargo_bay: {
      id: 'cargo_bay',
      text: 'Rows of sealed cargo containers line the walls. Most are empty, but your scanner detects valuable tech components in three of them. The containers have standard release mechanisms.',
      image: '📦',
      choices: [
        { text: 'Take the tech components', nextNode: 'take_cargo', effects: [{ variable: 'cargo', op: '+', value: 3 }] },
        { text: 'Look for a hidden compartment', nextNode: 'hidden_room', skillCheck: { stat: 'luck', min: 30 } },
        { text: 'Leave and go to bridge', nextNode: 'bridge' },
      ],
    },
    take_cargo: {
      id: 'take_cargo',
      text: 'You load the tech components onto your ship. Estimated value: decent. As you work, you notice scratch marks near one wall panel — someone was here recently.',
      image: '💰',
      choices: [
        { text: 'Investigate the scratch marks', nextNode: 'hidden_room', skillCheck: { stat: 'luck', min: 30 } },
        { text: 'Head to bridge with your loot', nextNode: 'bridge' },
      ],
    },
    hidden_room: {
      id: 'hidden_room',
      text: 'Your keen eyes spot a concealed panel! Behind it lies a hidden vault containing rare quantum crystals — worth a fortune on the black market. Someone stashed these here deliberately.',
      image: '💎',
      choices: [
        { text: 'Take the crystals', nextNode: 'ending_jackpot', effects: [{ variable: 'cargo', op: '+', value: 10 }] },
      ],
    },
    bridge: {
      id: 'bridge',
      text: 'The bridge computers still function. Station logs reveal this was a research outpost studying dark energy. The crew evacuated months ago after an "incident". The last entry mentions a sealed research lab.',
      image: '🖥️',
      choices: [
        { text: 'Download the research data', nextNode: 'ending_data', effects: [{ variable: 'trust', op: '+', value: 2 }] },
        { text: 'Try to unseal the research lab', nextNode: 'ending_danger' },
      ],
    },
    leave_early: {
      id: 'leave_early',
      text: 'You decide discretion is the better part of valor and engage your engines. As you pull away, you can\'t help wondering what secrets the station held. Maybe next time.',
      image: '🚀',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_jackpot: {
      id: 'ending_jackpot',
      text: 'The quantum crystals are incredibly valuable! Combined with the tech components, this haul will fund your operations for weeks. You undock and set course for the nearest trading post, grinning ear to ear.',
      image: '🏆',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_data: {
      id: 'ending_data',
      text: 'The research data downloads successfully — dark energy measurements that could advance science significantly. You transmit the data to the Galactic Research Council. They respond with a generous reward and gratitude.',
      image: '📊',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_danger: {
      id: 'ending_danger',
      text: 'The research lab door opens to reveal... nothing dangerous. Just abandoned equipment and a personal log from the lead scientist containing coordinates to three other research stations. This could lead to future discoveries!',
      image: '🔬',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
  },
};

const QUEST_PIRATE_AMBUSH: TextQuest = {
  id: 'pirate_ambush',
  title: 'Pirate Ambush',
  description: 'A pirate fleet drops out of hyperspace around your ship. Fight, negotiate, or flee — your choice.',
  image: '☠️',
  difficulty: 'medium',
  estimatedTime: '5-7 min',
  startNode: 'start',
  variables: { reputation: 0, ammo: 10, credits: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'ALERT! Three pirate corvettes materialize from hyperspace, weapons hot. Their leader hails you: "Surrender your cargo, and you live. Resist, and we scrap you." Your shields are charging.',
      image: '🚨',
      choices: [
        { text: 'Power up weapons — fight!', nextNode: 'fight_start', skillCheck: { stat: 'firepower', min: 50 } },
        { text: 'Try to outrun them', nextNode: 'flee', skillCheck: { stat: 'speed', min: 40 } },
        { text: 'Open a channel — negotiate', nextNode: 'negotiate' },
        { text: 'Bluff — claim you\'re military', nextNode: 'bluff', skillCheck: { stat: 'luck', min: 60 } },
      ],
    },
    fight_start: {
      id: 'fight_start',
      text: 'Your weapons roar to life! The first corvette takes a direct hit and veers off, trailing smoke. The other two scatter and begin flanking maneuvers. Your targeting computer locks on.',
      image: '💥',
      choices: [
        { text: 'Focus fire on the lead ship', nextNode: 'fight_aggressive', effects: [{ variable: 'ammo', op: '-', value: 5 }] },
        { text: 'Disable their engines', nextNode: 'fight_tactical', effects: [{ variable: 'ammo', op: '-', value: 3 }] },
      ],
    },
    fight_aggressive: {
      id: 'fight_aggressive',
      text: 'Your barrage tears through the lead ship\'s hull. It explodes in a brilliant fireball! The remaining pirates, seeing their leader destroyed, break formation and retreat. Victory! You salvage valuable parts from the wreckage.',
      image: '🔥',
      choices: [
        { text: 'Salvage the wreckage', nextNode: 'ending_fight_win', effects: [{ variable: 'credits', op: '+', value: 500 }, { variable: 'reputation', op: '+', value: 3 }] },
      ],
    },
    fight_tactical: {
      id: 'fight_tactical',
      text: 'Precision shots disable two ships\' engines. The pirates are stranded! They surrender immediately, begging for mercy. Their cargo holds are full of stolen goods.',
      image: '🎯',
      choices: [
        { text: 'Take their cargo and leave', nextNode: 'ending_merciful', effects: [{ variable: 'credits', op: '+', value: 600 }, { variable: 'reputation', op: '+', value: 5 }] },
        { text: 'Report them to patrol', nextNode: 'ending_lawful', effects: [{ variable: 'reputation', op: '+', value: 8 }] },
      ],
    },
    flee: {
      id: 'flee',
      text: 'You slam the throttle to maximum! Your ship lurches forward as pirate lasers streak past. One grazes your shields but holds. You\'re pulling ahead — they can\'t match your speed!',
      image: '💨',
      choices: [
        { text: 'Jump to hyperspace immediately', nextNode: 'ending_escape' },
        { text: 'Lead them into asteroid field', nextNode: 'asteroid_trap', effects: [{ variable: 'reputation', op: '+', value: 1 }] },
      ],
    },
    asteroid_trap: {
      id: 'asteroid_trap',
      text: 'You weave through the asteroid field with expert piloting. The pirates follow but they\'re not as skilled — one clips an asteroid and detonates. The others pull back, cursing over comms. In the debris, you spot a cargo pod they dropped.',
      image: '☄️',
      choices: [
        { text: 'Grab the cargo pod and jump', nextNode: 'ending_clever', effects: [{ variable: 'credits', op: '+', value: 300 }] },
      ],
    },
    negotiate: {
      id: 'negotiate',
      text: '"Interesting..." the pirate captain muses. "Most just run or fight. What do you propose?" She seems intrigued by your boldness. Maybe there\'s a deal to be made.',
      image: '🤝',
      choices: [
        { text: 'Offer to trade route information', nextNode: 'trade_intel', effects: [{ variable: 'reputation', op: '-', value: 2 }] },
        { text: 'Offer to hire them as escorts', nextNode: 'hire_pirates', effects: [{ variable: 'credits', op: '-', value: 200 }] },
        { text: 'Challenge the captain to a duel', nextNode: 'duel' },
      ],
    },
    trade_intel: {
      id: 'trade_intel',
      text: 'You share coordinates of unpatrolled trade routes. The captain grins. "Useful information. You\'re free to go — and take this as payment." She transfers credits to your account. A morally grey deal, but you survive.',
      image: '🗺️',
      choices: [
        { text: 'Accept and leave quietly', nextNode: 'ending_grey', effects: [{ variable: 'credits', op: '+', value: 150 }] },
      ],
    },
    hire_pirates: {
      id: 'hire_pirates',
      text: '"An employer? Now THAT\'s a first!" The captain agrees to escort you through dangerous space for 200 credits. True to their word, the pirates escort you safely. They even fend off another threat along the way.',
      image: '👥',
      choices: [
        { text: 'Thank them and part ways', nextNode: 'ending_alliance', effects: [{ variable: 'reputation', op: '+', value: 3 }] },
      ],
    },
    duel: {
      id: 'duel',
      text: 'The captain laughs heartily. "A duel? I like your style!" Ship-to-ship, one on one. Her corvette swoops in. It\'s a fierce exchange of fire, but you land the decisive shot on her engines. "You win, ranger. We\'ll let you pass — with a bonus."',
      image: '⚔️',
      choices: [
        { text: 'Accept the honor prize', nextNode: 'ending_honor', effects: [{ variable: 'credits', op: '+', value: 800 }, { variable: 'reputation', op: '+', value: 10 }] },
      ],
    },
    bluff: {
      id: 'bluff',
      text: '"This is Captain Vega of the Galactic Patrol Corvette Sentinel. Stand down or face the full force of the 7th Fleet." A long pause on the comm... "R-roger that, Sentinel. We\'re leaving!" The pirates scatter in panic. Your bluff worked!',
      image: '🎭',
      choices: [
        { text: 'Fly away, trying not to laugh', nextNode: 'ending_bluff' },
      ],
    },
    ending_fight_win: {
      id: 'ending_fight_win',
      text: 'You salvage valuable weapons components and fuel cells from the wreckage. Your reputation as a fighter grows across the sector. Pirates will think twice before targeting you again.',
      image: '🏆',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_merciful: {
      id: 'ending_merciful',
      text: 'You strip the pirates\' cargo holds clean. Stolen luxury goods, rare minerals, and encrypted data chips — all yours now. The disabled pirates float helplessly as you jump away. Profitable and professional.',
      image: '💰',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_lawful: {
      id: 'ending_lawful',
      text: 'Galactic Patrol arrives to arrest the pirates. The commander commends your actions: "The sector is safer thanks to you." You receive an official commendation and a substantial reward.',
      image: '⭐',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_escape: {
      id: 'ending_escape',
      text: 'Hyperspace envelops your ship in blue light. Safe! You escaped without a scratch, though your pride took a small hit. Sometimes surviving IS winning.',
      image: '🌀',
      choices: [],
      isEnding: true,
      reward: { coins: 50 },
    },
    ending_clever: {
      id: 'ending_clever',
      text: 'The cargo pod contains high-grade fuel cells and encrypted trade manifests. Not the biggest haul, but earned through cunning piloting. You set course for the nearest station, feeling clever.',
      image: '🧠',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_grey: {
      id: 'ending_grey',
      text: 'You fly away with the credits, but the pirate captain\'s words echo: "See you around, partner." You\'ve made a dangerous ally — or enemy. Only time will tell.',
      image: '🌑',
      choices: [],
      isEnding: true,
      reward: { coins: 150 },
    },
    ending_alliance: {
      id: 'ending_alliance',
      text: 'As the pirate ships peel away, the captain sends a final message: "If you ever need muscle, ping this frequency." You\'ve gained unlikely allies in the lawless frontier.',
      image: '🤝',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_honor: {
      id: 'ending_honor',
      text: 'The pirate captain salutes you through the viewport. "You\'ve earned our respect, ranger. Here\'s our best loot." An impressive haul and a reputation that will echo through the sector.',
      image: '👑',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_bluff: {
      id: 'ending_bluff',
      text: 'As the pirates vanish into hyperspace, you can\'t contain a grin. No shots fired, no damage taken, and they even dropped some cargo pods in their panic. Sometimes words ARE the best weapon.',
      image: '😏',
      choices: [],
      isEnding: true,
      reward: { coins: 350 },
    },
  },
};

const QUEST_DARK_MATTER: TextQuest = {
  id: 'dark_matter_anomaly',
  title: 'Dark Matter Anomaly',
  description: 'A massive dark matter anomaly distorts space around your ship. Incredible scientific opportunity — or deadly trap?',
  image: '🌀',
  difficulty: 'hard',
  estimatedTime: '7-10 min',
  startNode: 'start',
  variables: { energy: 100, data: 0, risk: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'A swirling vortex of dark matter fills your viewport — a phenomenon never recorded before. Your instruments go haywire. The anomaly pulses with otherworldly energy. Galactic Science Council would pay fortunes for this data.',
      image: '🌀',
      choices: [
        { text: 'Approach cautiously and scan', nextNode: 'approach', effects: [{ variable: 'risk', op: '+', value: 10 }] },
        { text: 'Deploy remote probe first', nextNode: 'probe', effects: [{ variable: 'energy', op: '-', value: 15 }] },
        { text: 'Log coordinates and leave', nextNode: 'ending_cautious' },
      ],
    },
    approach: {
      id: 'approach',
      text: 'As you approach, the anomaly\'s gravity tugs at your ship. Shields fluctuate but hold. Scanners flood with data — dark matter density readings, quantum fluctuations, exotic particle signatures. This is groundbreaking!',
      image: '📡',
      choices: [
        { text: 'Go deeper — maximize data', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 25 }, { variable: 'data', op: '+', value: 30 }] },
        { text: 'Maintain safe distance, scan longer', nextNode: 'safe_scan', effects: [{ variable: 'data', op: '+', value: 15 }, { variable: 'energy', op: '-', value: 10 }] },
        { text: 'Reinforce shields first', nextNode: 'reinforce', skillCheck: { stat: 'shield', min: 40 } },
      ],
    },
    probe: {
      id: 'probe',
      text: 'Your remote probe enters the anomaly and transmits fascinating data. But after 30 seconds, the signal distorts. The probe captures images of... structures inside the anomaly? They look almost artificial.',
      image: '🛰️',
      choices: [
        { text: 'Follow the probe inside', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 20 }, { variable: 'data', op: '+', value: 20 }] },
        { text: 'Analyze the structures from here', nextNode: 'analyze_structures', effects: [{ variable: 'data', op: '+', value: 25 }] },
        { text: 'Recall probe — too dangerous', nextNode: 'safe_scan', effects: [{ variable: 'data', op: '+', value: 10 }] },
      ],
    },
    reinforce: {
      id: 'reinforce',
      text: 'Your shield expertise pays off! You reroute power and create a stable energy cocoon around the ship. Now you can approach the anomaly with much less risk. The readings are incredible from this close.',
      image: '🛡️',
      choices: [
        { text: 'Enter the anomaly edge', nextNode: 'deep_scan', effects: [{ variable: 'data', op: '+', value: 30 }, { variable: 'risk', op: '+', value: 10 }] },
        { text: 'Collect data and withdraw', nextNode: 'ending_scientific', effects: [{ variable: 'data', op: '+', value: 40 }] },
      ],
    },
    safe_scan: {
      id: 'safe_scan',
      text: 'You maintain distance, collecting hours of data. The anomaly pulses rhythmically — almost like breathing. Your data banks fill with unprecedented measurements. Then you detect something: a signal FROM the anomaly.',
      image: '📊',
      choices: [
        { text: 'Attempt to decode the signal', nextNode: 'decode_signal', effects: [{ variable: 'data', op: '+', value: 20 }] },
        { text: 'Record and leave — enough risk', nextNode: 'ending_scientific', effects: [{ variable: 'data', op: '+', value: 10 }] },
      ],
    },
    analyze_structures: {
      id: 'analyze_structures',
      text: 'Enhanced imaging reveals the structures are geometric — definitely not natural. They appear to be some kind of framework or lattice, built by an intelligence unknown to galactic records. Your heart races.',
      image: '🔬',
      choices: [
        { text: 'Enter the anomaly to investigate', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 30 }, { variable: 'data', op: '+', value: 35 }] },
        { text: 'Broadcast discovery to Science Council', nextNode: 'ending_discovery', effects: [{ variable: 'data', op: '+', value: 30 }] },
      ],
    },
    deep_scan: {
      id: 'deep_scan',
      text: 'You breach the anomaly\'s outer layer. Reality warps around you — colors shift, time feels elastic. Your instruments capture data faster than you can process. Then you see them: crystalline structures floating in the void, pulsing with energy.',
      image: '✨',
      choices: [
        { text: 'Collect a crystal sample', nextNode: 'crystal_grab', effects: [{ variable: 'risk', op: '+', value: 20 }, { variable: 'energy', op: '-', value: 20 }] },
        { text: 'Scan the crystals and retreat', nextNode: 'ending_explorer', effects: [{ variable: 'data', op: '+', value: 40 }] },
        { text: 'Navigate deeper toward the center', nextNode: 'center', effects: [{ variable: 'risk', op: '+', value: 40 }, { variable: 'energy', op: '-', value: 30 }], skillCheck: { stat: 'speed', min: 60 } },
      ],
    },
    crystal_grab: {
      id: 'crystal_grab',
      text: 'You extend the cargo arm and grasp a crystal. It vibrates with impossible energy — readings suggest it could power a small city! But the anomaly reacts to the disturbance. The walls of the vortex begin collapsing inward.',
      image: '💎',
      choices: [
        { text: 'FULL THRUST — get out now!', nextNode: 'ending_crystal_escape', effects: [{ variable: 'energy', op: '-', value: 25 }] },
        { text: 'Grab another crystal on the way out', nextNode: 'ending_greedy', effects: [{ variable: 'risk', op: '+', value: 30 }], skillCheck: { stat: 'luck', min: 70 } },
      ],
    },
    center: {
      id: 'center',
      text: 'At the anomaly\'s heart, you find something extraordinary: a stable pocket of space containing what appears to be an ancient gateway. Alien glyphs glow along its frame. Your translator identifies fragments — "bridge between stars."',
      image: '🌟',
      choices: [
        { text: 'Transmit everything and retreat', nextNode: 'ending_greatest_discovery' },
        { text: 'Attempt to activate the gateway', nextNode: 'ending_gateway', effects: [{ variable: 'risk', op: '+', value: 50 }] },
      ],
    },
    decode_signal: {
      id: 'decode_signal',
      text: 'The signal isn\'t random — it\'s a mathematical sequence! Prime numbers, followed by coordinates. Someone, or something, is broadcasting from inside the anomaly. This changes everything.',
      image: '🔢',
      choices: [
        { text: 'Follow the coordinates inside', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 25 }, { variable: 'data', op: '+', value: 25 }] },
        { text: 'Record and report to Science Council', nextNode: 'ending_signal', effects: [{ variable: 'data', op: '+', value: 35 }] },
      ],
    },
    ending_cautious: {
      id: 'ending_cautious',
      text: 'You log the coordinates and jump to safety. The anomaly\'s location is valuable intel alone. Science Council thanks you for the report and transfers a modest finder\'s fee.',
      image: '📋',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_scientific: {
      id: 'ending_scientific',
      text: 'Your data package contains measurements that will rewrite physics textbooks. The Science Council is ecstatic — they award you a research grant and name the anomaly after you.',
      image: '🏅',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_discovery: {
      id: 'ending_discovery',
      text: 'Your broadcast of the artificial structures causes a galactic sensation. You\'re hailed as the discoverer of evidence of a precursor civilization. Fame, credits, and a place in history are yours.',
      image: '🌍',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_explorer: {
      id: 'ending_explorer',
      text: 'You exit the anomaly with detailed scans of the crystalline structures. Analysis suggests they\'re energy storage devices of immense capacity. Multiple research institutions bid for your data. A profitable expedition!',
      image: '🔭',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_crystal_escape: {
      id: 'ending_crystal_escape',
      text: 'Engines screaming, you blast out of the collapsing anomaly with the crystal secured. As you reach safe distance, the vortex implodes behind you. The crystal alone is worth a fortune — pure concentrated dark energy.',
      image: '🏆',
      choices: [],
      isEnding: true,
      reward: { coins: 900 },
    },
    ending_greedy: {
      id: 'ending_greedy',
      text: 'Against all odds, you snag a second crystal as the anomaly collapses! Your ship rattles violently but holds together. You emerge with TWO dark energy crystals — enough to fund a small fleet. Lady Luck smiles on the bold.',
      image: '💎',
      choices: [],
      isEnding: true,
      reward: { coins: 1200 },
    },
    ending_greatest_discovery: {
      id: 'ending_greatest_discovery',
      text: 'You transmit everything — the gateway, the glyphs, the coordinates. As you retreat, you know this will change galactic civilization forever. The Science Council names you "Explorer of the Age." Maximum reward, maximum prestige.',
      image: '👑',
      choices: [],
      isEnding: true,
      reward: { coins: 1000 },
    },
    ending_gateway: {
      id: 'ending_gateway',
      text: 'The gateway activates! A brilliant flash — and suddenly you see stars you don\'t recognize. You\'re in an unknown sector of the galaxy. Your nav computer recalculates... you\'re 10,000 light-years from home. But the gateway works both ways. You\'ve discovered instant interstellar travel!',
      image: '🌌',
      choices: [],
      isEnding: true,
      reward: { coins: 1100 },
    },
    ending_signal: {
      id: 'ending_signal',
      text: 'The Science Council\'s response is immediate: "This is the most significant discovery in galactic history. Stand by — we\'re dispatching a full research fleet." Your find of the intelligent signal earns you a permanent place in the historical record.',
      image: '📡',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
  },
};

export const TEXT_QUEST_DATA: TextQuest[] = [
  QUEST_ABANDONED_STATION,
  QUEST_PIRATE_AMBUSH,
  QUEST_DARK_MATTER,
];

// ── Engine Functions ──

export function getTextQuests(): TextQuest[] {
  return TEXT_QUEST_DATA;
}

function storageKey(questId: string, address: string): string {
  return `text_quest_v1_${address}_${questId}`;
}

export function getQuestSave(questId: string, address: string): QuestSaveState | null {
  try {
    const raw = localStorage.getItem(storageKey(questId, address));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveQuestState(state: QuestSaveState, address: string): void {
  try {
    localStorage.setItem(storageKey(state.questId, address), JSON.stringify(state));
  } catch {}
}

export function getCompletedQuests(address: string): string[] {
  const completed: string[] = [];
  for (const q of TEXT_QUEST_DATA) {
    const save = getQuestSave(q.id, address);
    if (save?.completed) completed.push(q.id);
  }
  return completed;
}

export function resetQuest(questId: string, address: string): void {
  try {
    localStorage.removeItem(storageKey(questId, address));
  } catch {}
}

function checkCondition(condition: QuestChoice['condition'], variables: Record<string, number>): boolean {
  if (!condition) return true;
  const val = variables[condition.variable] ?? 0;
  switch (condition.op) {
    case '>=': return val >= condition.value;
    case '<=': return val <= condition.value;
    case '==': return val === condition.value;
    default: return true;
  }
}

function checkSkill(skillCheck: QuestChoice['skillCheck'], shipStats: ShipStats): boolean {
  if (!skillCheck) return true;
  return (shipStats[skillCheck.stat] ?? 0) >= skillCheck.min;
}

function applyEffects(variables: Record<string, number>, effects?: QuestChoice['effects']): Record<string, number> {
  if (!effects) return variables;
  const updated = { ...variables };
  for (const e of effects) {
    const current = updated[e.variable] ?? 0;
    switch (e.op) {
      case '+': updated[e.variable] = current + e.value; break;
      case '-': updated[e.variable] = current - e.value; break;
      case '=': updated[e.variable] = e.value; break;
    }
  }
  return updated;
}

export function startQuest(quest: TextQuest): QuestSaveState {
  return {
    questId: quest.id,
    currentNode: quest.startNode,
    variables: { ...quest.variables },
    choices: [],
    completed: false,
  };
}

export function processChoice(
  quest: TextQuest,
  state: QuestSaveState,
  choiceIndex: number,
  shipStats: ShipStats,
): QuestSaveState {
  const node = quest.nodes[state.currentNode];
  if (!node || node.isEnding) return state;

  const visibleChoices = node.choices.filter(c => checkCondition(c.condition, state.variables));
  const choice = visibleChoices[choiceIndex];
  if (!choice) return state;

  // Check skill requirement — if failed, return same state (UI should prevent this)
  if (!checkSkill(choice.skillCheck, shipStats)) return state;

  const newVariables = applyEffects(state.variables, choice.effects);
  const nextNode = quest.nodes[choice.nextNode];

  const newState: QuestSaveState = {
    ...state,
    currentNode: choice.nextNode,
    variables: newVariables,
    choices: [...state.choices, choice.nextNode],
  };

  if (nextNode?.isEnding) {
    newState.completed = true;
    newState.endingId = nextNode.id;
    newState.reward = nextNode.reward;
    newState.completedAt = new Date().toISOString();
  }

  return newState;
}

export function getVisibleChoices(quest: TextQuest, state: QuestSaveState, shipStats: ShipStats): (QuestChoice & { passesSkillCheck: boolean })[] {
  const node = quest.nodes[state.currentNode];
  if (!node) return [];
  return node.choices
    .filter(c => checkCondition(c.condition, state.variables))
    .map(c => ({
      ...c,
      passesSkillCheck: checkSkill(c.skillCheck, shipStats),
    }));
}
