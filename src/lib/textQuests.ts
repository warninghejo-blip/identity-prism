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
  image?: string;   // path to /quests/ image or emoji
  choices: QuestChoice[];
  isEnding?: boolean;
  reward?: { coins: number; xp?: number };
}

export interface TextQuest {
  id: string;
  title: string;
  description: string;
  image: string;    // path to /quests/ image or emoji
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
  image: '/quests/commando_ship.jpg',
  difficulty: 'easy',
  estimatedTime: '3-5 min',
  startNode: 'start',
  variables: { cargo: 0, trust: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'Your scanners pick up an abandoned space station orbiting a dead star. Emergency lights flicker weakly through the viewport. Sensors show no life signs, but energy readings are unstable. The docking port appears functional.',
      image: '/quests/commando_ship.jpg',
      choices: [
        { text: 'Dock and investigate', nextNode: 'dock' },
        { text: 'Scan from outside first', nextNode: 'scan' },
        { text: 'Too risky — fly away', nextNode: 'leave_early' },
      ],
    },
    scan: {
      id: 'scan',
      text: 'Long-range scans reveal three zones: a cargo bay with sealed containers, a bridge with active computers, and a mysterious sealed section emitting energy spikes. No hostile signatures detected.',
      image: '/quests/stealth_scan.jpg',
      choices: [
        { text: 'Dock and head to cargo bay', nextNode: 'cargo_bay', effects: [{ variable: 'trust', op: '+', value: 1 }] },
        { text: 'Dock and head to bridge', nextNode: 'bridge' },
      ],
    },
    dock: {
      id: 'dock',
      text: 'Docking clamps engage with a metallic screech. The airlock hisses open. Inside, emergency lights cast long shadows. You see corridors leading to the cargo bay and the bridge.',
      image: '/quests/citadel_interior.jpg',
      choices: [
        { text: 'Go to cargo bay', nextNode: 'cargo_bay' },
        { text: 'Go to bridge', nextNode: 'bridge' },
      ],
    },
    cargo_bay: {
      id: 'cargo_bay',
      text: 'Rows of sealed cargo containers line the walls. Most are empty, but your scanner detects valuable tech components in three of them. The containers have standard release mechanisms.',
      image: '/quests/citadel_interior.jpg',
      choices: [
        { text: 'Take the tech components', nextNode: 'take_cargo', effects: [{ variable: 'cargo', op: '+', value: 3 }] },
        { text: 'Look for a hidden compartment', nextNode: 'hidden_room', skillCheck: { stat: 'luck', min: 30 } },
        { text: 'Leave and go to bridge', nextNode: 'bridge' },
      ],
    },
    take_cargo: {
      id: 'take_cargo',
      text: 'You load the tech components onto your ship. Estimated value: decent. As you work, you notice scratch marks near one wall panel — someone was here recently.',
      image: '/quests/energy_pilot.jpg',
      choices: [
        { text: 'Investigate the scratch marks', nextNode: 'hidden_room', skillCheck: { stat: 'luck', min: 30 } },
        { text: 'Head to bridge with your loot', nextNode: 'bridge' },
      ],
    },
    hidden_room: {
      id: 'hidden_room',
      text: 'Your keen eyes spot a concealed panel! Behind it lies a hidden vault containing rare quantum crystals — worth a fortune on the black market. Someone stashed these here deliberately.',
      image: '/quests/tomb_ruins.jpg',
      choices: [
        { text: 'Take the crystals', nextNode: 'ending_jackpot', effects: [{ variable: 'cargo', op: '+', value: 10 }] },
      ],
    },
    bridge: {
      id: 'bridge',
      text: 'The bridge computers still function. Station logs reveal this was a research outpost studying dark energy. The crew evacuated months ago after an "incident". The last entry mentions a sealed research lab.',
      image: '/quests/energy_pilot.jpg',
      choices: [
        { text: 'Download the research data', nextNode: 'ending_data', effects: [{ variable: 'trust', op: '+', value: 2 }] },
        { text: 'Try to unseal the research lab', nextNode: 'ending_danger' },
      ],
    },
    leave_early: {
      id: 'leave_early',
      text: 'You decide discretion is the better part of valor and engage your engines. As you pull away, you can\'t help wondering what secrets the station held. Maybe next time.',
      image: '/quests/depth_submarine.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_jackpot: {
      id: 'ending_jackpot',
      text: 'The quantum crystals are incredibly valuable! Combined with the tech components, this haul will fund your operations for weeks. You undock and set course for the nearest trading post, grinning ear to ear.',
      image: '/quests/kiberrazum_ai.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_data: {
      id: 'ending_data',
      text: 'The research data downloads successfully — dark energy measurements that could advance science significantly. You transmit the data to the Galactic Research Council. They respond with a generous reward and gratitude.',
      image: '/quests/stealth_scan.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_danger: {
      id: 'ending_danger',
      text: 'The research lab door opens to reveal... nothing dangerous. Just abandoned equipment and a personal log from the lead scientist containing coordinates to three other research stations. This could lead to future discoveries!',
      image: '/quests/tomb_ruins.jpg',
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
  image: '/quests/penetrator_pirate.jpg',
  difficulty: 'medium',
  estimatedTime: '5-7 min',
  startNode: 'start',
  variables: { reputation: 0, ammo: 10, credits: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'ALERT! Three pirate corvettes materialize from hyperspace, weapons hot. Their leader hails you: "Surrender your cargo, and you live. Resist, and we scrap you." Your shields are charging.',
      image: '/quests/penetrator_pirate.jpg',
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
      image: '/quests/battle_army.jpg',
      choices: [
        { text: 'Focus fire on the lead ship', nextNode: 'fight_aggressive', effects: [{ variable: 'ammo', op: '-', value: 5 }] },
        { text: 'Disable their engines', nextNode: 'fight_tactical', effects: [{ variable: 'ammo', op: '-', value: 3 }] },
      ],
    },
    fight_aggressive: {
      id: 'fight_aggressive',
      text: 'Your barrage tears through the lead ship\'s hull. It explodes in a brilliant fireball! The remaining pirates, seeing their leader destroyed, break formation and retreat. Victory! You salvage valuable parts from the wreckage.',
      image: '/quests/battle2.jpg',
      choices: [
        { text: 'Salvage the wreckage', nextNode: 'ending_fight_win', effects: [{ variable: 'credits', op: '+', value: 500 }, { variable: 'reputation', op: '+', value: 3 }] },
      ],
    },
    fight_tactical: {
      id: 'fight_tactical',
      text: 'Precision shots disable two ships\' engines. The pirates are stranded! They surrender immediately, begging for mercy. Their cargo holds are full of stolen goods.',
      image: '/quests/siege_fortress.jpg',
      choices: [
        { text: 'Take their cargo and leave', nextNode: 'ending_merciful', effects: [{ variable: 'credits', op: '+', value: 600 }, { variable: 'reputation', op: '+', value: 5 }] },
        { text: 'Report them to patrol', nextNode: 'ending_lawful', effects: [{ variable: 'reputation', op: '+', value: 8 }] },
      ],
    },
    flee: {
      id: 'flee',
      text: 'You slam the throttle to maximum! Your ship lurches forward as pirate lasers streak past. One grazes your shields but holds. You\'re pulling ahead — they can\'t match your speed!',
      image: '/quests/depth_submarine.jpg',
      choices: [
        { text: 'Jump to hyperspace immediately', nextNode: 'ending_escape' },
        { text: 'Lead them into asteroid field', nextNode: 'asteroid_trap', effects: [{ variable: 'reputation', op: '+', value: 1 }] },
      ],
    },
    asteroid_trap: {
      id: 'asteroid_trap',
      text: 'You weave through the asteroid field with expert piloting. The pirates follow but they\'re not as skilled — one clips an asteroid and detonates. The others pull back, cursing over comms. In the debris, you spot a cargo pod they dropped.',
      image: '/quests/bomber_explosion.jpg',
      choices: [
        { text: 'Grab the cargo pod and jump', nextNode: 'ending_clever', effects: [{ variable: 'credits', op: '+', value: 300 }] },
      ],
    },
    negotiate: {
      id: 'negotiate',
      text: '"Interesting..." the pirate captain muses. "Most just run or fight. What do you propose?" She seems intrigued by your boldness. Maybe there\'s a deal to be made.',
      image: '/quests/galaxy_aliens.jpg',
      choices: [
        { text: 'Offer to trade route information', nextNode: 'trade_intel', effects: [{ variable: 'reputation', op: '-', value: 2 }] },
        { text: 'Offer to hire them as escorts', nextNode: 'hire_pirates', effects: [{ variable: 'credits', op: '-', value: 200 }] },
        { text: 'Challenge the captain to a duel', nextNode: 'duel' },
      ],
    },
    trade_intel: {
      id: 'trade_intel',
      text: 'You share coordinates of unpatrolled trade routes. The captain grins. "Useful information. You\'re free to go — and take this as payment." She transfers credits to your account. A morally grey deal, but you survive.',
      image: '/quests/spy_city.jpg',
      choices: [
        { text: 'Accept and leave quietly', nextNode: 'ending_grey', effects: [{ variable: 'credits', op: '+', value: 150 }] },
      ],
    },
    hire_pirates: {
      id: 'hire_pirates',
      text: '"An employer? Now THAT\'s a first!" The captain agrees to escort you through dangerous space for 200 credits. True to their word, the pirates escort you safely. They even fend off another threat along the way.',
      image: '/quests/penetrator_pirate.jpg',
      choices: [
        { text: 'Thank them and part ways', nextNode: 'ending_alliance', effects: [{ variable: 'reputation', op: '+', value: 3 }] },
      ],
    },
    duel: {
      id: 'duel',
      text: 'The captain laughs heartily. "A duel? I like your style!" Ship-to-ship, one on one. Her corvette swoops in. It\'s a fierce exchange of fire, but you land the decisive shot on her engines. "You win, ranger. We\'ll let you pass — with a bonus."',
      image: '/quests/battle_army.jpg',
      choices: [
        { text: 'Accept the honor prize', nextNode: 'ending_honor', effects: [{ variable: 'credits', op: '+', value: 800 }, { variable: 'reputation', op: '+', value: 10 }] },
      ],
    },
    bluff: {
      id: 'bluff',
      text: '"This is Captain Vega of the Galactic Patrol Corvette Sentinel. Stand down or face the full force of the 7th Fleet." A long pause on the comm... "R-roger that, Sentinel. We\'re leaving!" The pirates scatter in panic. Your bluff worked!',
      image: '/quests/war_alien.jpg',
      choices: [
        { text: 'Fly away, trying not to laugh', nextNode: 'ending_bluff' },
      ],
    },
    ending_fight_win: {
      id: 'ending_fight_win',
      text: 'You salvage valuable weapons components and fuel cells from the wreckage. Your reputation as a fighter grows across the sector. Pirates will think twice before targeting you again.',
      image: '/quests/battle2.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_merciful: {
      id: 'ending_merciful',
      text: 'You strip the pirates\' cargo holds clean. Stolen luxury goods, rare minerals, and encrypted data chips — all yours now. The disabled pirates float helplessly as you jump away. Profitable and professional.',
      image: '/quests/siege_fortress.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_lawful: {
      id: 'ending_lawful',
      text: 'Galactic Patrol arrives to arrest the pirates. The commander commends your actions: "The sector is safer thanks to you." You receive an official commendation and a substantial reward.',
      image: '/quests/spy_city.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_escape: {
      id: 'ending_escape',
      text: 'Hyperspace envelops your ship in blue light. Safe! You escaped without a scratch, though your pride took a small hit. Sometimes surviving IS winning.',
      image: '/quests/depth_submarine.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 50 },
    },
    ending_clever: {
      id: 'ending_clever',
      text: 'The cargo pod contains high-grade fuel cells and encrypted trade manifests. Not the biggest haul, but earned through cunning piloting. You set course for the nearest station, feeling clever.',
      image: '/quests/bomber_explosion.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_grey: {
      id: 'ending_grey',
      text: 'You fly away with the credits, but the pirate captain\'s words echo: "See you around, partner." You\'ve made a dangerous ally — or enemy. Only time will tell.',
      image: '/quests/war_alien.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 150 },
    },
    ending_alliance: {
      id: 'ending_alliance',
      text: 'As the pirate ships peel away, the captain sends a final message: "If you ever need muscle, ping this frequency." You\'ve gained unlikely allies in the lawless frontier.',
      image: '/quests/penetrator_pirate.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_honor: {
      id: 'ending_honor',
      text: 'The pirate captain salutes you through the viewport. "You\'ve earned our respect, ranger. Here\'s our best loot." An impressive haul and a reputation that will echo through the sector.',
      image: '/quests/galaxy_aliens.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_bluff: {
      id: 'ending_bluff',
      text: 'As the pirates vanish into hyperspace, you can\'t contain a grin. No shots fired, no damage taken, and they even dropped some cargo pods in their panic. Sometimes words ARE the best weapon.',
      image: '/quests/diehard_alien.jpg',
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
  image: '/quests/stealth_anomaly.jpg',
  difficulty: 'hard',
  estimatedTime: '7-10 min',
  startNode: 'start',
  variables: { energy: 100, data: 0, risk: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'A swirling vortex of dark matter fills your viewport — a phenomenon never recorded before. Your instruments go haywire. The anomaly pulses with otherworldly energy. Galactic Science Council would pay fortunes for this data.',
      image: '/quests/stealth_anomaly.jpg',
      choices: [
        { text: 'Approach cautiously and scan', nextNode: 'approach', effects: [{ variable: 'risk', op: '+', value: 10 }] },
        { text: 'Deploy remote probe first', nextNode: 'probe', effects: [{ variable: 'energy', op: '-', value: 15 }] },
        { text: 'Log coordinates and leave', nextNode: 'ending_cautious' },
      ],
    },
    approach: {
      id: 'approach',
      text: 'As you approach, the anomaly\'s gravity tugs at your ship. Shields fluctuate but hold. Scanners flood with data — dark matter density readings, quantum fluctuations, exotic particle signatures. This is groundbreaking!',
      image: '/quests/stealth_scan.jpg',
      choices: [
        { text: 'Go deeper — maximize data', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 25 }, { variable: 'data', op: '+', value: 30 }] },
        { text: 'Maintain safe distance, scan longer', nextNode: 'safe_scan', effects: [{ variable: 'data', op: '+', value: 15 }, { variable: 'energy', op: '-', value: 10 }] },
        { text: 'Reinforce shields first', nextNode: 'reinforce', skillCheck: { stat: 'shield', min: 40 } },
      ],
    },
    probe: {
      id: 'probe',
      text: 'Your remote probe enters the anomaly and transmits fascinating data. But after 30 seconds, the signal distorts. The probe captures images of... structures inside the anomaly? They look almost artificial.',
      image: '/quests/energy_controls.jpg',
      choices: [
        { text: 'Follow the probe inside', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 20 }, { variable: 'data', op: '+', value: 20 }] },
        { text: 'Analyze the structures from here', nextNode: 'analyze_structures', effects: [{ variable: 'data', op: '+', value: 25 }] },
        { text: 'Recall probe — too dangerous', nextNode: 'safe_scan', effects: [{ variable: 'data', op: '+', value: 10 }] },
      ],
    },
    reinforce: {
      id: 'reinforce',
      text: 'Your shield expertise pays off! You reroute power and create a stable energy cocoon around the ship. Now you can approach the anomaly with much less risk. The readings are incredible from this close.',
      image: '/quests/energy_pilot.jpg',
      choices: [
        { text: 'Enter the anomaly edge', nextNode: 'deep_scan', effects: [{ variable: 'data', op: '+', value: 30 }, { variable: 'risk', op: '+', value: 10 }] },
        { text: 'Collect data and withdraw', nextNode: 'ending_scientific', effects: [{ variable: 'data', op: '+', value: 40 }] },
      ],
    },
    safe_scan: {
      id: 'safe_scan',
      text: 'You maintain distance, collecting hours of data. The anomaly pulses rhythmically — almost like breathing. Your data banks fill with unprecedented measurements. Then you detect something: a signal FROM the anomaly.',
      image: '/quests/stealth_anomaly.jpg',
      choices: [
        { text: 'Attempt to decode the signal', nextNode: 'decode_signal', effects: [{ variable: 'data', op: '+', value: 20 }] },
        { text: 'Record and leave — enough risk', nextNode: 'ending_scientific', effects: [{ variable: 'data', op: '+', value: 10 }] },
      ],
    },
    analyze_structures: {
      id: 'analyze_structures',
      text: 'Enhanced imaging reveals the structures are geometric — definitely not natural. They appear to be some kind of framework or lattice, built by an intelligence unknown to galactic records. Your heart races.',
      image: '/quests/kiberrazum_ai.jpg',
      choices: [
        { text: 'Enter the anomaly to investigate', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 30 }, { variable: 'data', op: '+', value: 35 }] },
        { text: 'Broadcast discovery to Science Council', nextNode: 'ending_discovery', effects: [{ variable: 'data', op: '+', value: 30 }] },
      ],
    },
    deep_scan: {
      id: 'deep_scan',
      text: 'You breach the anomaly\'s outer layer. Reality warps around you — colors shift, time feels elastic. Your instruments capture data faster than you can process. Then you see them: crystalline structures floating in the void, pulsing with energy.',
      image: '/quests/depth_submarine.jpg',
      choices: [
        { text: 'Collect a crystal sample', nextNode: 'crystal_grab', effects: [{ variable: 'risk', op: '+', value: 20 }, { variable: 'energy', op: '-', value: 20 }] },
        { text: 'Scan the crystals and retreat', nextNode: 'ending_explorer', effects: [{ variable: 'data', op: '+', value: 40 }] },
        { text: 'Navigate deeper toward the center', nextNode: 'center', effects: [{ variable: 'risk', op: '+', value: 40 }, { variable: 'energy', op: '-', value: 30 }], skillCheck: { stat: 'speed', min: 60 } },
      ],
    },
    crystal_grab: {
      id: 'crystal_grab',
      text: 'You extend the cargo arm and grasp a crystal. It vibrates with impossible energy — readings suggest it could power a small city! But the anomaly reacts to the disturbance. The walls of the vortex begin collapsing inward.',
      image: '/quests/tomb_ruins.jpg',
      choices: [
        { text: 'FULL THRUST — get out now!', nextNode: 'ending_crystal_escape', effects: [{ variable: 'energy', op: '-', value: 25 }] },
        { text: 'Grab another crystal on the way out', nextNode: 'ending_greedy', effects: [{ variable: 'risk', op: '+', value: 30 }], skillCheck: { stat: 'luck', min: 70 } },
      ],
    },
    center: {
      id: 'center',
      text: 'At the anomaly\'s heart, you find something extraordinary: a stable pocket of space containing what appears to be an ancient gateway. Alien glyphs glow along its frame. Your translator identifies fragments — "bridge between stars."',
      image: '/quests/kiberrazum_ai.jpg',
      choices: [
        { text: 'Transmit everything and retreat', nextNode: 'ending_greatest_discovery' },
        { text: 'Attempt to activate the gateway', nextNode: 'ending_gateway', effects: [{ variable: 'risk', op: '+', value: 50 }] },
      ],
    },
    decode_signal: {
      id: 'decode_signal',
      text: 'The signal isn\'t random — it\'s a mathematical sequence! Prime numbers, followed by coordinates. Someone, or something, is broadcasting from inside the anomaly. This changes everything.',
      image: '/quests/energy_controls.jpg',
      choices: [
        { text: 'Follow the coordinates inside', nextNode: 'deep_scan', effects: [{ variable: 'risk', op: '+', value: 25 }, { variable: 'data', op: '+', value: 25 }] },
        { text: 'Record and report to Science Council', nextNode: 'ending_signal', effects: [{ variable: 'data', op: '+', value: 35 }] },
      ],
    },
    ending_cautious: {
      id: 'ending_cautious',
      text: 'You log the coordinates and jump to safety. The anomaly\'s location is valuable intel alone. Science Council thanks you for the report and transfers a modest finder\'s fee.',
      image: '/quests/depth_submarine.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_scientific: {
      id: 'ending_scientific',
      text: 'Your data package contains measurements that will rewrite physics textbooks. The Science Council is ecstatic — they award you a research grant and name the anomaly after you.',
      image: '/quests/stealth_scan.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_discovery: {
      id: 'ending_discovery',
      text: 'Your broadcast of the artificial structures causes a galactic sensation. You\'re hailed as the discoverer of evidence of a precursor civilization. Fame, credits, and a place in history are yours.',
      image: '/quests/kiberrazum_ai.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_explorer: {
      id: 'ending_explorer',
      text: 'You exit the anomaly with detailed scans of the crystalline structures. Analysis suggests they\'re energy storage devices of immense capacity. Multiple research institutions bid for your data. A profitable expedition!',
      image: '/quests/stealth_anomaly.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_crystal_escape: {
      id: 'ending_crystal_escape',
      text: 'Engines screaming, you blast out of the collapsing anomaly with the crystal secured. As you reach safe distance, the vortex implodes behind you. The crystal alone is worth a fortune — pure concentrated dark energy.',
      image: '/quests/bomber_explosion.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 900 },
    },
    ending_greedy: {
      id: 'ending_greedy',
      text: 'Against all odds, you snag a second crystal as the anomaly collapses! Your ship rattles violently but holds together. You emerge with TWO dark energy crystals — enough to fund a small fleet. Lady Luck smiles on the bold.',
      image: '/quests/tomb_ruins.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 1200 },
    },
    ending_greatest_discovery: {
      id: 'ending_greatest_discovery',
      text: 'You transmit everything — the gateway, the glyphs, the coordinates. As you retreat, you know this will change galactic civilization forever. The Science Council names you "Explorer of the Age." Maximum reward, maximum prestige.',
      image: '/quests/kiberrazum_ai.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 1000 },
    },
    ending_gateway: {
      id: 'ending_gateway',
      text: 'The gateway activates! A brilliant flash — and suddenly you see stars you don\'t recognize. You\'re in an unknown sector of the galaxy. Your nav computer recalculates... you\'re 10,000 light-years from home. But the gateway works both ways. You\'ve discovered instant interstellar travel!',
      image: '/quests/stealth_anomaly.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 1100 },
    },
    ending_signal: {
      id: 'ending_signal',
      text: 'The Science Council\'s response is immediate: "This is the most significant discovery in galactic history. Stand by — we\'re dispatching a full research fleet." Your find of the intelligent signal earns you a permanent place in the historical record.',
      image: '/quests/energy_controls.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
  },
};

const QUEST_PRISON_BREAK: TextQuest = {
  id: 'prison_break',
  title: 'Prison Break',
  description: 'Falsely imprisoned on a Malok planet. The charges are fabricated, the guards are corrupt, and the exit is locked. Find a way out before your trial — which is not going to be fair.',
  image: '/quests/prison_00.jpg',
  difficulty: 'medium',
  estimatedTime: '5 min',
  startNode: 'start',
  variables: { strength: 0, intel: 0, allies: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'You wake up on a metal bunk in a Malok detention cell. Your head throbs. The last thing you remember is accepting a cargo delivery job on Malokan Prime. Now you\'re here, and a bored guard is reading the charges against you: "illegal weapons transport, conspiracy against the state, and insulting the Warlord\'s portrait." The last one carries the heaviest sentence. You have until tomorrow\'s trial to get out — or stay in forever.',
      image: '/quests/prison_00.jpg',
      choices: [
        { text: 'Inspect the cell carefully', nextNode: 'inspect_cell' },
        { text: 'Talk to the guard', nextNode: 'talk_guard' },
        { text: 'Shout for a lawyer', nextNode: 'shout_lawyer' },
      ],
    },
    inspect_cell: {
      id: 'inspect_cell',
      text: 'You run your hands along every wall. Crumbling mortar near the floor vent. A loose grate bolt. A previous prisoner scratched a map into the bunk frame — tunnels beneath the east wing, leading to the service yard. Whoever made this map either escaped or gave up. You\'re betting on the former.',
      image: '/quests/prison_01.jpg',
      choices: [
        { text: 'Start loosening the vent grate quietly', nextNode: 'start_tunnel', effects: [{ variable: 'intel', op: '+', value: 2 }] },
        { text: 'Keep the info and talk to the guard first', nextNode: 'talk_guard', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    talk_guard: {
      id: 'talk_guard',
      text: 'The guard — a stocky Malok named Vrrk — eyes you with mild curiosity. He\'s seen plenty of "falsely accused" types. But when you mention that the actual contraband was owned by Customs Officer Draal, Vrrk\'s jaw tightens. Draal apparently owes Vrrk three months of gambling debts. Interesting.',
      image: '/quests/prison_02.jpg',
      choices: [
        { text: 'Offer to help Vrrk expose Draal if he lets you out', nextNode: 'bribe_guard', effects: [{ variable: 'allies', op: '+', value: 1 }] },
        { text: 'Ask Vrrk about the prison layout', nextNode: 'prison_layout', effects: [{ variable: 'intel', op: '+', value: 1 }] },
        { text: 'Try to overpower him when he opens the door', nextNode: 'fight_guard', skillCheck: { stat: 'firepower', min: 45 } },
      ],
    },
    shout_lawyer: {
      id: 'shout_lawyer',
      text: 'The response comes quickly — a rustle of papers, then a face at the bars. Not a lawyer. It\'s a fellow prisoner from the next cell: a wiry Peleng named Squix who claims to be a "legal consultant, lockpick, and occasional acrobat." He can\'t get you out, but he can get a message to someone outside. For a price — two ration bars.',
      image: '/quests/prison_03.jpg',
      choices: [
        { text: 'Give Squix the ration bars — send a message', nextNode: 'use_ally', effects: [{ variable: 'allies', op: '+', value: 2 }] },
        { text: 'Ask Squix about the tunnels instead', nextNode: 'start_tunnel', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    prison_layout: {
      id: 'prison_layout',
      text: 'Vrrk shrugs and, surprisingly, actually describes the layout. Three guard rotations, a shift change at midnight, one camera with a busted power cable in corridor B. He seems almost proud of how poorly run this place is. "Not my job to fix it," he mutters, returning to his data-pad.',
      image: '/quests/prison_04.jpg',
      choices: [
        { text: 'Plan to move during the midnight shift change', nextNode: 'midnight_run', effects: [{ variable: 'intel', op: '+', value: 2 }] },
        { text: 'Combine this with the tunnel map — dual approach', nextNode: 'start_tunnel', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    bribe_guard: {
      id: 'bribe_guard',
      text: 'Vrrk listens. He scratches the back of his neck. "You\'d testify? Against Draal?" He glances down the corridor, then back at you. "...I can get you as far as the east gate. After that, you\'re a ghost." He slides a keycard under the cell door. It\'s warm — he must have been holding it for a while.',
      image: '/quests/prison_05.jpg',
      choices: [
        { text: 'Take the keycard and move now', nextNode: 'east_gate' },
        { text: 'Wait for the midnight shift — safer with timing', nextNode: 'midnight_run', effects: [{ variable: 'allies', op: '+', value: 1 }] },
      ],
    },
    start_tunnel: {
      id: 'start_tunnel',
      text: 'Under the bunk, you work the grate loose with a shiv fashioned from your boot buckle. Behind it: a narrow passage, dust, darkness, and the smell of old rust. The map scratched on the bunk suggests it leads to the service yard — about 40 meters of crawling. You\'ll need luck that no one patched the exit grate.',
      image: '/quests/prison_06.jpg',
      choices: [
        { text: 'Crawl through and hope for the best', nextNode: 'tunnel_luck', skillCheck: { stat: 'luck', min: 50 } },
        { text: 'Take your time — listen at each junction', nextNode: 'tunnel_careful', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    use_ally: {
      id: 'use_ally',
      text: 'Squix gets a message out. By morning, a maintenance worker appears in the corridor — your contact on the outside, pretending to repair a pipe. He slips a data chip through the vent: prison schematics, patrol patterns, and a forged transfer order. "Use the riot as cover," the chip reads. "One starts in Block D in two hours."',
      image: '/quests/prison_07.jpg',
      choices: [
        { text: 'Wait for the riot and move with the chaos', nextNode: 'use_riot' },
        { text: 'Use the forged transfer order instead', nextNode: 'forged_order' },
      ],
    },
    fight_guard: {
      id: 'fight_guard',
      text: 'When Vrrk opens the slot to pass the evening meal, you grab his arm and yank — hard. He stumbles into the door, keys scattering. You snatch them before he recovers, and he\'s too dazed to sound the alarm immediately. You have maybe sixty seconds.',
      image: '/quests/prison_08.jpg',
      choices: [
        { text: 'Sprint for the exit — pure speed', nextNode: 'sprint_exit', skillCheck: { stat: 'speed', min: 40 } },
        { text: 'Lock him in and take your time', nextNode: 'east_gate' },
      ],
    },
    tunnel_luck: {
      id: 'tunnel_luck',
      text: 'Against all odds, the exit grate pushes open easily — freshly oiled hinges. Someone else must have used this recently. You emerge into the service yard, blinking in the cold night air. A supply transport idles near the fence. The driver is asleep.',
      image: '/quests/prison_09.jpg',
      choices: [
        { text: 'Stow away in the transport', nextNode: 'ending_tunnel' },
      ],
    },
    tunnel_careful: {
      id: 'tunnel_careful',
      text: 'Listening at each junction saves you twice — once when a patrol passes, once when a maintenance bot trundles through. After twenty painstaking minutes, you push through the exit grate into the cold service yard. The outer fence is fifty meters away. A guard tower sweeps its light every forty seconds.',
      image: '/quests/prison_10.jpg',
      choices: [
        { text: 'Time the light and run for the fence', nextNode: 'ending_tunnel' },
        { text: 'Hijack the supply transport instead', nextNode: 'ending_tunnel' },
      ],
    },
    midnight_run: {
      id: 'midnight_run',
      text: 'You wait. At midnight, the shift change creates three perfect minutes of corridor confusion. You slip out of your unlocked cell — Vrrk left it ajar — and move through corridor B under the busted camera. The east gate looms ahead, keycard ready.',
      image: '/quests/prison_11.jpg',
      choices: [
        { text: 'Use the keycard and walk out calmly', nextNode: 'ending_bribe' },
        { text: 'Disable the alarm panel first — just in case', nextNode: 'ending_hack' },
      ],
    },
    east_gate: {
      id: 'east_gate',
      text: 'The keycard works. The east gate clicks open. Outside, the Malokan city sprawls under a red industrial haze. Vrrk\'s voice crackles over your earpiece — he left you a civilian comm unit too: "Evidence against Draal is in the customs terminal, node 7. Don\'t forget our deal." You won\'t.',
      image: '/quests/prison_12.jpg',
      choices: [
        { text: 'Grab the evidence and honor the deal', nextNode: 'ending_bribe' },
        { text: 'Get out of the system immediately', nextNode: 'ending_tunnel' },
      ],
    },
    use_riot: {
      id: 'use_riot',
      text: 'Block D explodes in chaos right on schedule. Alarms blare. Guards rush past without a glance at you. You join a stream of confused prisoners heading for the exercise yard, then peel off toward the outer fence. The riot is spectacular — someone apparently released three caged Klissan battle-beasts. You wish you had time to watch.',
      image: '/quests/battle_army.jpg',
      choices: [
        { text: 'Over the fence while the guards are busy', nextNode: 'ending_riot', skillCheck: { stat: 'speed', min: 40 } },
        { text: 'Grab a guard uniform in the confusion', nextNode: 'ending_riot', effects: [{ variable: 'allies', op: '+', value: 1 }] },
      ],
    },
    forged_order: {
      id: 'forged_order',
      text: 'You present the forged transfer order with maximum confidence. The desk sergeant squints at it, types something, squints again. "Transfer to Station 9... authorized by... Colonel Vrex?" He hesitates. You don\'t. "The Colonel does not like to be kept waiting," you say flatly. The sergeant stamps the form.',
      image: '/quests/prison_05.jpg',
      choices: [
        { text: 'Walk out the front door like you own the place', nextNode: 'ending_hack' },
      ],
    },
    sprint_exit: {
      id: 'sprint_exit',
      text: 'You run like the Klissans are behind you — and technically one alarm later, they might be. You vault a barrier, slide under a closing blast door, and burst into the outer service corridor at full speed. The exit is ahead. You do not stop.',
      image: '/quests/prison_08.jpg',
      choices: [
        { text: 'Keep running — don\'t look back', nextNode: 'ending_riot' },
      ],
    },
    ending_tunnel: {
      id: 'ending_tunnel',
      text: 'You make it out through the service yard and vanish into the city before the morning count even begins. By the time Customs Officer Draal\'s fabricated charges are processed, you\'re three star systems away and laughing. The tunnel exit is sealed the next day — you got the last ride.',
      image: '/quests/prison_09.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_riot: {
      id: 'ending_riot',
      text: 'You slip away in the chaos while half the prison staff is occupied subduing escaped battle-beasts. A sympathetic transport pilot — tipped off by Squix\'s message — picks you up at the service gate. The riot makes the evening news. Your escape does not. Perfect.',
      image: '/quests/battle_army.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_bribe: {
      id: 'ending_bribe',
      text: 'You send Vrrk the evidence on Draal anonymously. He forwards it to Internal Affairs with his name on it. Draal is arrested within the week, and Vrrk collects his debt plus a commendation. He sends you a single message: "We\'re square." In this galaxy, that passes for friendship.',
      image: '/quests/prison_05.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_hack: {
      id: 'ending_hack',
      text: 'The forged paperwork and Vrrk\'s corridor intel combine beautifully. You walk out the front entrance of a maximum-security Malok prison with a stamped form, a borrowed uniform, and absolutely zero casualties. This story will sound made-up at every bar you tell it in. Good.',
      image: '/quests/prison_12.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
  },
};

const QUEST_DOMINATOR_FACTORY: TextQuest = {
  id: 'dominator_factory',
  title: 'Dominator Factory',
  description: 'Deep in enemy territory, a Dominator production complex churns out battle robots by the thousands. Your mission: get in, plant charges, and get out. Simple. Nothing about this will be simple.',
  image: '/quests/robots_00.jpg',
  difficulty: 'hard',
  estimatedTime: '7 min',
  startNode: 'start',
  variables: { detection: 0, charges: 3, intel: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'The briefing was short: "Dominator Factory Delta-9. Three weeks ago it didn\'t exist. Now it produces 200 assault units per day." You\'ve been dropped in the snow two kilometers from the complex. Your pack contains three demolition charges, a jammer, and a data spike. The factory sits under a dome of energy shielding — you\'ll need to get inside the hard way. Sensors show two possible entry points.',
      image: '/quests/robots_00.jpg',
      choices: [
        { text: 'Approach via the ventilation ducts on the north side', nextNode: 'vent_approach' },
        { text: 'Steal a Dominator maintenance unit for cover', nextNode: 'disguise_approach', skillCheck: { stat: 'luck', min: 55 } },
        { text: 'Scout the perimeter thoroughly first', nextNode: 'scout_perimeter', effects: [{ variable: 'intel', op: '+', value: 2 }] },
      ],
    },
    scout_perimeter: {
      id: 'scout_perimeter',
      text: 'Two hours of careful observation reveals: patrol patterns with a 90-second gap near the east service entrance, a maintenance team that enters at irregular intervals, and — most interestingly — a data relay tower that, if accessed, could feed you the entire factory layout. The cold is becoming a problem but the intelligence is worth it.',
      image: '/quests/build_00.jpg',
      choices: [
        { text: 'Access the data relay tower', nextNode: 'data_relay', effects: [{ variable: 'intel', op: '+', value: 3 }] },
        { text: 'Use the 90-second gap at the east entrance', nextNode: 'east_entrance', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    vent_approach: {
      id: 'vent_approach',
      text: 'The ventilation duct is tight, hot, and smells of machine oil and ozone. You crawl for what feels like a kilometer. Through the grilles, you glimpse the factory floor — row upon row of half-assembled Dominator units twitching on assembly lines. Automated welders arc and flash. Two paths branch ahead: toward the assembly floor or toward the control room.',
      image: '/quests/robots_01.jpg',
      choices: [
        { text: 'Drop onto the assembly floor', nextNode: 'assembly_floor' },
        { text: 'Continue to the control room', nextNode: 'control_room_approach' },
      ],
    },
    disguise_approach: {
      id: 'disguise_approach',
      text: 'Against all probability, it works. You intercept a lone maintenance bot, crack its behavioral matrix in under ten minutes, and reprogram it to accept you as its assigned technician. The factory gates open without question. You stroll in wearing a hard hat and carrying a tool satchel, flanked by your temporary robot assistant.',
      image: '/quests/robots_02.jpg',
      choices: [
        { text: 'Head straight for the main reactor with your charges', nextNode: 'reactor_plant', effects: [{ variable: 'intel', op: '+', value: 1 }] },
        { text: 'Access a terminal and steal production intel first', nextNode: 'steal_intel', effects: [{ variable: 'intel', op: '+', value: 3 }] },
      ],
    },
    data_relay: {
      id: 'data_relay',
      text: 'The data spike plugs in. Factory schematics download in seconds — you now know the exact location of the three main production nodes, the reactor core, and the security override panel. You also spot something unexpected: a prisoner holding area. Someone is being held inside.',
      image: '/quests/build_01.jpg',
      choices: [
        { text: 'Use the schematics — hit all three production nodes', nextNode: 'east_entrance', effects: [{ variable: 'intel', op: '+', value: 2 }] },
        { text: 'Prioritize rescuing the prisoner', nextNode: 'east_entrance', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    east_entrance: {
      id: 'east_entrance',
      text: 'The 90-second gap is exactly as timed. You\'re through the service door and inside. The factory air is thick with heat and electromagnetic interference. A patrol route runs directly through the main corridor ahead — you\'ll need to sneak past, and they\'re running sensors.',
      image: '/quests/robots_03.jpg',
      choices: [
        { text: 'Sneak past the patrol — stay low', nextNode: 'sneak_patrol', skillCheck: { stat: 'speed', min: 50 } },
        { text: 'Use the jammer to blind their sensors', nextNode: 'jammer_use', effects: [{ variable: 'detection', op: '+', value: 1 }] },
        { text: 'Take a longer route through maintenance tunnels', nextNode: 'assembly_floor', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    assembly_floor: {
      id: 'assembly_floor',
      text: 'The assembly floor is enormous — a cathedral of industry dedicated to destruction. Hundreds of units in various states of completion move along conveyor lines. You spot three critical junctions: the power coupling array, the neural imprint stations, and the chassis fabricators. Destroying any two would cripple output for months. Destroying all three requires all your charges.',
      image: '/quests/robots_04.jpg',
      choices: [
        { text: 'Plant charges on the power couplings and fabricators', nextNode: 'plant_two_charges', condition: { variable: 'charges', op: '>=', value: 2 } },
        { text: 'Plant all three charges for maximum damage', nextNode: 'plant_all_charges', condition: { variable: 'charges', op: '>=', value: 3 } },
        { text: 'Steal production specs and abort the bombing', nextNode: 'steal_intel' },
      ],
    },
    control_room_approach: {
      id: 'control_room_approach',
      text: 'The control room overlooks the entire factory floor through thick transparisteel. Two Dominator supervisor units are present, running diagnostics. If you can access the main terminal undetected, you could trigger a system-wide shutdown — or download the factory\'s AI core for intelligence value. But those supervisors have motion sensors.',
      image: '/quests/robots_05.jpg',
      choices: [
        { text: 'Disable the supervisors and access the terminal', nextNode: 'control_room_hack', skillCheck: { stat: 'firepower', min: 45 } },
        { text: 'Wait for a diagnostic cycle — they go dormant', nextNode: 'control_room_sneak', condition: { variable: 'intel', op: '>=', value: 2 } },
      ],
    },
    sneak_patrol: {
      id: 'sneak_patrol',
      text: 'You flow through the shadows between patrol sweeps like you\'ve done this before — because you have. The Dominator units pass within two meters. Their sensors sweep, find nothing. You\'re through, undetected, and now standing at the entrance to the main production hub.',
      image: '/quests/robots_01.jpg',
      choices: [
        { text: 'Head for the reactor core', nextNode: 'reactor_plant', condition: { variable: 'charges', op: '>=', value: 1 } },
        { text: 'Go for the control room', nextNode: 'control_room_approach' },
      ],
    },
    jammer_use: {
      id: 'jammer_use',
      text: 'The jammer works — their sensors go dark for thirty seconds. Enough. You\'re past the patrol. But the jammer emits a residual signal; their central AI flags an anomaly. Detection ticks up. You\'re inside, but the clock is now ticking faster.',
      image: '/quests/robots_02.jpg',
      choices: [
        { text: 'Move fast — hit the reactor and run', nextNode: 'reactor_plant', effects: [{ variable: 'detection', op: '+', value: 1 }], condition: { variable: 'charges', op: '>=', value: 1 } },
        { text: 'Find a terminal and wipe the anomaly flag', nextNode: 'steal_intel', effects: [{ variable: 'intel', op: '+', value: 1 }] },
      ],
    },
    steal_intel: {
      id: 'steal_intel',
      text: 'The data spike goes into the nearest terminal. Production schedules, supply routes, the location of Factory Delta-10 and Delta-11 — this intel alone could redirect the war effort. The download takes three minutes. Each one feels like an hour. Detection creeps upward as the system notices the unauthorized access.',
      image: '/quests/build_00.jpg',
      choices: [
        { text: 'Grab the data and abort — don\'t risk it', nextNode: 'ending_intel_only', effects: [{ variable: 'intel', op: '+', value: 3 }] },
        { text: 'Data secured — now plant the charges', nextNode: 'reactor_plant', effects: [{ variable: 'detection', op: '+', value: 1 }, { variable: 'intel', op: '+', value: 3 }], condition: { variable: 'charges', op: '>=', value: 1 } },
      ],
    },
    control_room_hack: {
      id: 'control_room_hack',
      text: 'Both supervisor units are down in a fast, precise takedown. No alarm — yet. At the terminal, you find the factory\'s shutdown command, the AI core download option, and a self-destruct sequence labeled "EMERGENCY USE — AUTHORIZATION REQUIRED." You have thirty seconds before the next status ping.',
      image: '/quests/robots_05.jpg',
      choices: [
        { text: 'Trigger the complete factory shutdown', nextNode: 'ending_stealth_sabotage', condition: { variable: 'detection', op: '<=', value: 2 } },
        { text: 'Download the AI core and trigger shutdown', nextNode: 'ending_complete_destruction', effects: [{ variable: 'intel', op: '+', value: 5 }] },
      ],
    },
    control_room_sneak: {
      id: 'control_room_sneak',
      text: 'You waited — and it paid off. During the diagnostic cycle, both supervisors enter standby mode, sensors off. You have ninety seconds at the terminal. Your fingers fly across the interface. Factory schematics, shutdown codes, the AI core— you take everything.',
      image: '/quests/robots_05.jpg',
      choices: [
        { text: 'Initiate factory-wide destruction sequence', nextNode: 'ending_complete_destruction' },
      ],
    },
    plant_two_charges: {
      id: 'plant_two_charges',
      text: 'Charges placed at the power couplings and chassis fabricators. Thirty minutes on the timers. You move quickly toward the exit, passing rows of half-finished machines that have no idea they\'re about to become scrap.',
      image: '/quests/robots_04.jpg',
      choices: [
        { text: 'Get out fast', nextNode: 'ending_stealth_sabotage', condition: { variable: 'detection', op: '<=', value: 2 } },
        { text: 'Get out fast — alarm or no alarm', nextNode: 'escape_detected', condition: { variable: 'detection', op: '>=', value: 3 } },
      ],
    },
    plant_all_charges: {
      id: 'plant_all_charges',
      text: 'All three charges placed at critical junctions. The entire factory — power, assembly, fabrication — set to detonate simultaneously. You set the timer for twenty minutes. The walk back to the exit suddenly feels very long.',
      image: '/quests/robots_03.jpg',
      choices: [
        { text: 'Run for the exit — everything is in motion', nextNode: 'ending_complete_destruction' },
      ],
    },
    reactor_plant: {
      id: 'reactor_plant',
      text: 'The reactor core pulses with raw energy behind its shielding. One charge here would cripple the factory for weeks. Two charges would destroy it utterly. The heat is intense — your shield systems strain.',
      image: '/quests/robots_00.jpg',
      choices: [
        { text: 'Plant one charge and get out', nextNode: 'ending_stealth_sabotage', effects: [{ variable: 'charges', op: '-', value: 1 }], condition: { variable: 'detection', op: '<=', value: 2 } },
        { text: 'Plant two charges — total destruction', nextNode: 'ending_complete_destruction', effects: [{ variable: 'charges', op: '-', value: 2 }], skillCheck: { stat: 'shield', min: 45 } },
        { text: 'Alarms going off — fight your way out', nextNode: 'escape_detected', condition: { variable: 'detection', op: '>=', value: 3 } },
      ],
    },
    escape_detected: {
      id: 'escape_detected',
      text: 'Alarms shriek. Lights shift to red. Dominator units converge from every direction. Your charges are planted — there\'s no turning back, only forward. You fight through three waves of factory guards, taking hits on the way, before blasting out through the emergency exit as the first explosion rocks the building behind you.',
      image: '/quests/robots_03.jpg',
      choices: [
        { text: 'Push through to the extraction point', nextNode: 'ending_fight_out' },
      ],
    },
    ending_intel_only: {
      id: 'ending_intel_only',
      text: 'You extract with the data intact and yourself uninjured. Back at base, analysts spend three days processing what you pulled. Two more Dominator factories are located and targeted. The general shakes your hand. "You didn\'t blow anything up," he says, "but you saved ten thousand lives." The factory keeps running — for now. But its days are numbered.',
      image: '/quests/build_01.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_stealth_sabotage: {
      id: 'ending_stealth_sabotage',
      text: 'You\'re two kilometers away when the charges blow. The dome cracks, then collapses inward as secondary explosions cascade through the assembly lines. Production at Delta-9 is finished. No casualties on your side. No one even knows you were there. The mission log reads: "Cause of destruction: unknown." Perfect.',
      image: '/quests/bomber_explosion.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_fight_out: {
      id: 'ending_fight_out',
      text: 'You fight your way out like a one-person army, leaving a trail of disabled Dominator units behind you. The factory erupts as you clear the perimeter fence. Your extraction pilot does a double-take at the state of your armor. "Rough day?" she asks. You look back at the pillar of fire rising from Delta-9. "Productive," you say.',
      image: '/quests/robots_00.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_complete_destruction: {
      id: 'ending_complete_destruction',
      text: 'The explosion is visible from orbit. The reactor breach triggers a cascade that obliterates not just the factory but the surrounding infrastructure. Delta-9 is gone. The AI core data you extracted identifies two more hidden facilities. Command promotes you. The Dominators notice — they increase security at every remaining factory in the sector. You have made yourself famous in the worst possible way.',
      image: '/quests/bomber_explosion.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 1200 },
    },
    ending_captured: {
      id: 'ending_captured',
      text: 'Too many alarms, too little cover. Dominator units swarm you before you reach the exit. You wake up in a containment pod, your charges confiscated, your mission failed. On the upside: you\'ve now seen the inside of a Dominator processing facility in considerable detail. The rescue team that eventually extracts you finds your sketched schematics incredibly useful. Small comfort.',
      image: '/quests/robots_04.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 0 },
    },
  },
};

const QUEST_ELECTION_DAY: TextQuest = {
  id: 'election_day',
  title: 'Election Day',
  description: 'Governor Plox of Colony Vesta-4 needs a campaign manager. You need cash. It seemed like a good match. Then you met the other candidate.',
  image: '/quests/election_00.jpg',
  difficulty: 'easy',
  estimatedTime: '4 min',
  startNode: 'start',
  variables: { votes: 0, money: 100, scandal: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'Colony Vesta-4 is a pleasant backwater — tropical climate, friendly locals, absolutely nothing of strategic interest to anyone. Which is why it\'s baffling that the upcoming gubernatorial election has attracted the attention of three major trade guilds, one religious order, and what appears to be a Klissan diplomatic observer eating snacks in the corner. Your employer, incumbent Governor Plox, greets you with a handshake and a nervous smile. "My opponent, the Honorable Zrix, is ahead in the polls by twelve points. I need those points."',
      image: '/quests/election_00.jpg',
      choices: [
        { text: 'Organize a public rally at the spaceport', nextNode: 'rally', effects: [{ variable: 'votes', op: '+', value: 2 }] },
        { text: 'Commission a survey to find what voters actually want', nextNode: 'survey' },
        { text: 'Investigate Zrix — everyone has secrets', nextNode: 'investigate_zrix' },
      ],
    },
    rally: {
      id: 'rally',
      text: 'The rally is a success — mostly because you hire a band and give away free food. Governor Plox delivers a speech about infrastructure. The crowd listens politely. Local journalist Meen Vass asks you: "Is it true the Governor promised to build a second spaceport six years ago and nothing happened?" You make eye contact with Plox. He looks at the sky.',
      image: '/quests/election_01.jpg',
      choices: [
        { text: 'Defend the Governor — blame bureaucratic delays', nextNode: 'defend_governor', effects: [{ variable: 'votes', op: '+', value: 1 }] },
        { text: 'Pivot to future promises — new spaceport by next year', nextNode: 'new_promise', effects: [{ variable: 'votes', op: '+', value: 2 }, { variable: 'scandal', op: '+', value: 1 }] },
        { text: 'Quietly offer Journalist Meen a scoop on Zrix instead', nextNode: 'investigate_zrix', effects: [{ variable: 'scandal', op: '+', value: 1 }] },
      ],
    },
    survey: {
      id: 'survey',
      text: 'The survey results are illuminating. Voters care about: (1) water purification, which has been broken for two years, (2) the orbital trade route tax that Zrix claims to oppose but quietly supports, and (3) the persistent rumor that the Governor\'s cousin owns the only desalination company on the planet. Points one and two are fixable. Point three is... awkward.',
      image: '/quests/election_02.jpg',
      choices: [
        { text: 'Announce an emergency water fix — spend 50 credits', nextNode: 'fix_water', effects: [{ variable: 'money', op: '-', value: 50 }, { variable: 'votes', op: '+', value: 3 }] },
        { text: 'Expose Zrix\'s secret trade route support', nextNode: 'expose_zrix', effects: [{ variable: 'votes', op: '+', value: 2 }, { variable: 'scandal', op: '+', value: 1 }] },
        { text: 'Address the cousin rumor directly', nextNode: 'address_rumor', effects: [{ variable: 'scandal', op: '+', value: 1 }] },
      ],
    },
    investigate_zrix: {
      id: 'investigate_zrix',
      text: 'Zrix\'s background check turns up interesting material. He claims to be a "self-made entrepreneur" — technically true, in that he made himself using extensive loans from the Peleng Merchants\' Syndicate that he has not repaid. He also once ran a lottery that somehow paid out less than it took in. By 80%. You have material. The question is how you use it.',
      image: '/quests/election_03.jpg',
      choices: [
        { text: 'Release the information to the press — clean and legitimate', nextNode: 'expose_zrix', effects: [{ variable: 'votes', op: '+', value: 2 }] },
        { text: 'Approach Zrix privately — suggest he withdraw', nextNode: 'blackmail_zrix', effects: [{ variable: 'scandal', op: '+', value: 2 }] },
        { text: 'Hold the info as insurance and focus on positive campaign', nextNode: 'positive_campaign', effects: [{ variable: 'votes', op: '+', value: 1 }] },
      ],
    },
    defend_governor: {
      id: 'defend_governor',
      text: '"The delay was caused by the Regional Infrastructure Committee\'s eighteen-month review process, the subsequent budget reallocation, and the pandemic of \'22 that suspended all capital projects." All true. Journalist Meen looks mildly satisfied. The crowd nods. Two more voters show up to the signing table. Progress.',
      image: '/quests/election_01.jpg',
      choices: [
        { text: 'Push for the final vote — hold a second rally', nextNode: 'final_push', effects: [{ variable: 'votes', op: '+', value: 1 }] },
        { text: 'Check the polling numbers', nextNode: 'check_polls' },
      ],
    },
    new_promise: {
      id: 'new_promise',
      text: '"A new spaceport — by next year!" The crowd loves it. The Governor looks like he\'s swallowed something unpleasant. Later, in private: "Where is that money coming from?" You suggest creative accounting. He suggests you may have just made his life significantly more complicated. Four new volunteers sign up anyway.',
      image: '/quests/election_04.jpg',
      choices: [
        { text: 'Double down — announce more ambitious promises', nextNode: 'final_push', effects: [{ variable: 'votes', op: '+', value: 2 }, { variable: 'scandal', op: '+', value: 1 }] },
        { text: 'Pull back — focus on realistic platform', nextNode: 'positive_campaign' },
      ],
    },
    fix_water: {
      id: 'fix_water',
      text: 'Within 48 hours, the water purification system is repaired. The Governor announces it personally with you standing slightly behind him. The reaction is overwhelming — people are genuinely grateful. Three community leaders endorse Plox on the spot. Zrix\'s lead shrinks. This might actually work.',
      image: '/quests/election_02.jpg',
      choices: [
        { text: 'Capitalize — hold an event at the newly fixed facility', nextNode: 'final_push', effects: [{ variable: 'votes', op: '+', value: 2 }] },
      ],
    },
    expose_zrix: {
      id: 'expose_zrix',
      text: 'The story runs. The loans, the lottery, the secret trade stance — all documented. Zrix calls a press conference to deny everything. His denial is not convincing. Votes shift. Plox\'s numbers climb four points. The Peleng Syndicate sends a very formal letter of complaint to your temporary office address, which you wisely vacate.',
      image: '/quests/election_03.jpg',
      choices: [
        { text: 'Follow up with a policy debate challenge', nextNode: 'final_push', effects: [{ variable: 'votes', op: '+', value: 1 }] },
        { text: 'Let the story run its course — don\'t overplay', nextNode: 'check_polls' },
      ],
    },
    address_rumor: {
      id: 'address_rumor',
      text: 'The Governor confirms his cousin does own the desalination company. He also discloses that the company won its contract through a competitive tender — and charges 15% below market rate. "I wanted to avoid a conflict of interest, so I insisted on it," Plox says. That is somehow both a scandal and a compliment. Voters are confused but slightly impressed.',
      image: '/quests/election_05.jpg',
      choices: [
        { text: 'Run with "the honest Governor" narrative', nextNode: 'positive_campaign', effects: [{ variable: 'votes', op: '+', value: 2 }, { variable: 'scandal', op: '-', value: 1 }] },
      ],
    },
    blackmail_zrix: {
      id: 'blackmail_zrix',
      text: 'Zrix listens to your private meeting. He does not withdraw. Instead, he goes directly to Journalist Meen and reports the blackmail attempt. By morning, you are the story. "Campaign manager for Governor Plox attempts to suppress competition." Plox looks at you with profound disappointment. Your job just became dramatically harder.',
      image: '/quests/election_03.jpg',
      choices: [
        { text: 'Weather the scandal — keep working', nextNode: 'check_polls', effects: [{ variable: 'scandal', op: '+', value: 2 }, { variable: 'votes', op: '-', value: 2 }] },
      ],
    },
    positive_campaign: {
      id: 'positive_campaign',
      text: 'You build the rest of the campaign on Plox\'s genuine record: twelve years without a corruption charge, three infrastructure projects completed, consistently balanced budget. It\'s not glamorous. It works steadily. Voters respond to competence when you put it clearly in front of them.',
      image: '/quests/election_04.jpg',
      choices: [
        { text: 'Hold a final town hall and let Plox speak honestly', nextNode: 'final_push', effects: [{ variable: 'votes', op: '+', value: 2 }] },
      ],
    },
    check_polls: {
      id: 'check_polls',
      text: 'Current standings: Plox 47%, Zrix 45%, Undecided 8%. Too close. Election day is tomorrow. One more push could seal it — or one more scandal could end it.',
      image: '/quests/election_05.jpg',
      choices: [
        { text: 'Make a final push — get out the vote', nextNode: 'final_push', effects: [{ variable: 'votes', op: '+', value: 1 }] },
        { text: 'Do nothing and let the voters decide', nextNode: 'final_push' },
      ],
    },
    final_push: {
      id: 'final_push',
      text: 'Election day. The results come in precinct by precinct. The tension in Plox\'s campaign office could be cut with a plasma blade. You watch the numbers. You remember every choice that led here.',
      image: '/quests/election_00.jpg',
      choices: [
        { text: 'See the results', nextNode: 'check_outcome' },
      ],
    },
    check_outcome: {
      id: 'check_outcome',
      text: 'The votes are tallied. The outcome hinges on everything you did — and didn\'t do.',
      image: '/quests/election_01.jpg',
      choices: [
        { text: 'A clean campaign won the day', nextNode: 'ending_honest_win', condition: { variable: 'votes', op: '>=', value: 5 } },
        { text: 'The scandal broke everything', nextNode: 'ending_scandal_loss', condition: { variable: 'scandal', op: '>=', value: 3 } },
        { text: 'A narrow, complicated victory', nextNode: 'ending_corrupt_win' },
      ],
    },
    ending_honest_win: {
      id: 'ending_honest_win',
      text: 'Governor Plox wins by six points. His acceptance speech thanks "an extraordinarily capable campaign manager." You shake his hand in a room full of cheering colonists. The water works. The spaceport is still a promise. But for today, Vesta-4 feels like a place with a future. You accept your payment and a jar of locally produced honey — the finest in the system, apparently.',
      image: '/quests/election_04.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_corrupt_win: {
      id: 'ending_corrupt_win',
      text: 'Plox wins by two points. The margin is thin enough that Zrix demands a recount, which takes three weeks and finds fourteen additional votes for Plox from a retirement community that everyone forgot to include. You receive your fee in a plain envelope. No ceremony. Plox looks older. You feel complicated about it. The honey is still good.',
      image: '/quests/election_05.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_scandal_loss: {
      id: 'ending_scandal_loss',
      text: 'Zrix wins. Not by much, but enough. Governor Plox thanks you for your efforts with the pained grace of a man who knows better than to say what he actually thinks. The Klissan observer in the corner continues eating snacks, apparently unmoved by the democratic process. You leave Vesta-4 with your fee, a scandal on your recent record, and the firm conviction that politics is not your calling.',
      image: '/quests/election_03.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
  },
};

const QUEST_ALIEN_ZOO: TextQuest = {
  id: 'alien_zoo',
  title: 'Alien Zoo',
  description: 'The curator of the famous Xenopark is sick. You agreed to cover for one day. How hard can it be? The park contains 34 species, 3 of which are "conditionally docile."',
  image: '/quests/xenopark_00.jpg',
  difficulty: 'easy',
  estimatedTime: '3 min',
  startNode: 'start',
  variables: { happiness: 5, safety: 5, profit: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'The Xenopark morning briefing from Dr. Ylss\'s automated messages: "Feed the Klissan fire-beetles at 0900 — do not use your hands. The Gaalsian mirror-fish require darkness for feeding — close the blinds first. The Pelengian slime-hound is friendly but has not been friendly for three weeks. And whatever you do, do not open Enclosure 7." There is no explanation for Enclosure 7. You notice the enclosure number 7 on a door that is very securely padlocked.',
      image: '/quests/xenopark_00.jpg',
      choices: [
        { text: 'Start the morning feeding rounds', nextNode: 'morning_feeding' },
        { text: 'Check the zoo map and review all enclosures', nextNode: 'check_map', effects: [{ variable: 'safety', op: '+', value: 1 }] },
        { text: 'Immediately investigate Enclosure 7', nextNode: 'enclosure_7' },
      ],
    },
    check_map: {
      id: 'check_map',
      text: 'The map shows 34 enclosures, a visitor cafeteria, a gift shop, and a veterinary bay. Three enclosures are marked in red: the slime-hound, the Malok territorial-crabs, and Enclosure 7, which is labeled only as "PROJECT YLSS" in Dr. Ylss\'s handwriting. The park opens to visitors in 45 minutes. You have time for two things before they arrive.',
      image: '/quests/xenopark_01.jpg',
      choices: [
        { text: 'Complete the feeding rounds before opening', nextNode: 'morning_feeding', effects: [{ variable: 'happiness', op: '+', value: 1 }] },
        { text: 'Check in on the slime-hound first', nextNode: 'slime_hound' },
        { text: 'Prepare the gift shop — maximize visitor spending', nextNode: 'gift_shop', effects: [{ variable: 'profit', op: '+', value: 2 }] },
      ],
    },
    morning_feeding: {
      id: 'morning_feeding',
      text: 'The fire-beetles eat without incident — you used tongs. The mirror-fish shimmer beautifully in the dark. Most of the other animals accept their meals happily. Then you reach the slime-hound enclosure. The door is open. The bowl is full. The hound is not inside.',
      image: '/quests/gobsaur_00.jpg',
      choices: [
        { text: 'Search the park calmly before visitors arrive', nextNode: 'find_slime_hound' },
        { text: 'Open the park anyway — maybe it returns on its own', nextNode: 'park_open', effects: [{ variable: 'safety', op: '-', value: 2 } ] },
      ],
    },
    slime_hound: {
      id: 'slime_hound',
      text: 'The slime-hound — a large, glittering, hexapedal creature with three emotional states (content, anxious, and "structurally problematic") — is clearly in state two. It paces the enclosure, leaving luminescent footprints on the walls. Dr. Ylss\'s notes say: "When anxious, provide enrichment activity or warm auditory stimulation."',
      image: '/quests/gobsaur_01.jpg',
      choices: [
        { text: 'Sing to it — auditory stimulation, technically', nextNode: 'calm_creature', skillCheck: { stat: 'luck', min: 35 } },
        { text: 'Give it the enrichment toy from the supply cabinet', nextNode: 'calm_creature', effects: [{ variable: 'happiness', op: '+', value: 1 }] },
        { text: 'Leave it alone and hope it settles', nextNode: 'park_open', effects: [{ variable: 'safety', op: '-', value: 1 }] },
      ],
    },
    gift_shop: {
      id: 'gift_shop',
      text: 'The gift shop is in reasonable shape. You restock the plush fire-beetle toys (the best-sellers), arrange a "Xenopark Survival Kit" display near the entrance (containing sunscreen, earplugs, and a pamphlet explaining which animals can be photographed safely), and set up a premium experience package. The cafeteria staff arrive. One asks if you\'re "the replacement." You say yes with more confidence than you feel.',
      image: '/quests/xenopark_00.jpg',
      choices: [
        { text: 'Open the park and see what happens', nextNode: 'park_open' },
        { text: 'Do the morning feeding first — creatures need it', nextNode: 'morning_feeding', effects: [{ variable: 'happiness', op: '+', value: 1 }] },
      ],
    },
    enclosure_7: {
      id: 'enclosure_7',
      text: 'The padlock is substantial. You find the key hanging on a hook labeled "DO NOT USE" in four languages. Inside is a single creature that defies easy categorization: roughly spherical, covered in soft fur that shifts color, hovering about half a meter off the ground, and emitting a very quiet sound that might be humming. It notices you. Its color shifts to a warm gold. It floats closer.',
      image: '/quests/xenolog_00.jpg',
      choices: [
        { text: 'Back away slowly and relock the door', nextNode: 'park_open', effects: [{ variable: 'safety', op: '+', value: 1 }] },
        { text: 'Let it out — maybe it needs space', nextNode: 'creature_loose', effects: [{ variable: 'safety', op: '-', value: 3 }, { variable: 'happiness', op: '+', value: 2 }] },
      ],
    },
    find_slime_hound: {
      id: 'find_slime_hound',
      text: 'You locate the slime-hound in the cafeteria kitchen, eating a tray of Gaalsian grain patties and looking extremely pleased with itself. The kitchen staff are standing on the countertops. You approach slowly, making the sounds described in Dr. Ylss\'s handbook as "comforting gurgles." The hound regards you. Then it burps luminescently and walks back to its enclosure.',
      image: '/quests/gobsaur_00.jpg',
      choices: [
        { text: 'Open the park — crisis averted', nextNode: 'park_open', effects: [{ variable: 'safety', op: '+', value: 1 }] },
      ],
    },
    calm_creature: {
      id: 'calm_creature',
      text: 'Whether it\'s your singing, the toy, or sheer luck, the slime-hound gradually settles. The luminescent pacing slows. It curls into a surprisingly compact shape and makes a sound like a distant thunderstorm. Peaceful. Safety restored. A zoo keeper passes and gives you an impressed nod.',
      image: '/quests/gobsaur_01.jpg',
      choices: [
        { text: 'Open the park — you\'ve earned it', nextNode: 'park_open', effects: [{ variable: 'happiness', op: '+', value: 1 }, { variable: 'safety', op: '+', value: 1 }] },
      ],
    },
    park_open: {
      id: 'park_open',
      text: 'Visitors stream in. Children press faces against enclosure glass. A school group arrives with forty students and one overwhelmed teacher. The fire-beetles prove enormously popular. The mirror-fish exhibit sells out of the souvenir light-diffraction cards by noon. Then, inevitably, something requires your immediate attention.',
      image: '/quests/xenopark_01.jpg',
      choices: [
        { text: 'A visitor claims a territorial-crab took his hat', nextNode: 'crab_incident', effects: [{ variable: 'profit', op: '+', value: 1 }] },
        { text: 'The school group wants a special tour of the dangerous exhibits', nextNode: 'school_tour' },
        { text: 'Assess the day and close up — go to endings', nextNode: 'end_of_day' },
      ],
    },
    creature_loose: {
      id: 'creature_loose',
      text: 'The spherical creature floats serenely out of Enclosure 7 and into the main park. Visitors react with astonishment and then delight — it floats over the crowd, shifting colors in response to different people, apparently reading emotions and reflecting them back as light. Children follow it in a mesmerized procession. It is, objectively, the best thing that has ever happened to this zoo.',
      image: '/quests/xenolog_01.jpg',
      choices: [
        { text: 'Let it roam — this is incredible marketing', nextNode: 'end_of_day', effects: [{ variable: 'profit', op: '+', value: 3 }, { variable: 'happiness', op: '+', value: 2 }] },
      ],
    },
    crab_incident: {
      id: 'crab_incident',
      text: 'The Malok territorial-crab has indeed taken the hat. It is wearing the hat. It appears satisfied. The visitor is less satisfied. Negotiations are delicate — the crab responds poorly to direct eye contact and sudden movements, and it can pinch through a standard glove. Dr. Ylss\'s notes offer one suggestion: "distract with shiny objects."',
      image: '/quests/newflora_00.jpg',
      choices: [
        { text: 'Offer the crab a reflective feeding disk', nextNode: 'end_of_day', effects: [{ variable: 'happiness', op: '+', value: 1 }, { variable: 'profit', op: '+', value: 1 }] },
        { text: 'Offer the visitor a complimentary hat from the gift shop', nextNode: 'end_of_day', effects: [{ variable: 'profit', op: '-', value: 1 }, { variable: 'happiness', op: '+', value: 1 }] },
      ],
    },
    school_tour: {
      id: 'school_tour',
      text: 'You take the school group on an improvised tour, explaining each creature with a mixture of facts from Dr. Ylss\'s handbook and inspired speculation. The children are rapt. One asks what Enclosure 7 contains. "A very important ongoing research subject," you say firmly. The teacher gives you a grateful look. You get a rating card: 9.5 out of 10.',
      image: '/quests/xenopark_00.jpg',
      choices: [
        { text: 'Close out the day', nextNode: 'end_of_day', effects: [{ variable: 'happiness', op: '+', value: 1 }, { variable: 'profit', op: '+', value: 1 }] },
      ],
    },
    end_of_day: {
      id: 'end_of_day',
      text: 'The park closes. Creatures fed, enclosures secured, visitors dispersed. Dr. Ylss\'s automated message arrives: "How did it go?" You consider everything that happened today.',
      image: '/quests/xenopark_01.jpg',
      choices: [
        { text: 'A perfect day — check outcome', nextNode: 'ending_perfect', condition: { variable: 'happiness', op: '>=', value: 7 } },
        { text: 'Incident report required — check outcome', nextNode: 'ending_incident', condition: { variable: 'safety', op: '<=', value: 2 } },
        { text: 'Profitable chaos — check outcome', nextNode: 'ending_profit', condition: { variable: 'profit', op: '>=', value: 4 } },
        { text: 'A normal, complicated day', nextNode: 'ending_incident' },
      ],
    },
    ending_perfect: {
      id: 'ending_perfect',
      text: 'Dr. Ylss reviews your shift report with visible relief. Every creature accounted for. Visitor satisfaction at record levels. No injuries, no escape incidents, no interstellar incidents. "You\'re hired," she says. You politely decline — one day was enough — and accept your payment with a plush fire-beetle as a bonus.',
      image: '/quests/xenolog_00.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 350 },
    },
    ending_incident: {
      id: 'ending_incident',
      text: 'There is a minor incident report. It is three pages long. The Malok Territorial Crab\'s behavior requires documentation. The slime-hound\'s cafeteria visit requires documentation. Enclosure 7 may or may not require documentation depending on whether anyone asks. Dr. Ylss sighs and pays you. "You kept everyone alive," she says. "That\'s the baseline."',
      image: '/quests/newflora_01.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_profit: {
      id: 'ending_profit',
      text: 'Today was the highest revenue day in Xenopark history. The gift shop sold out of everything. Premium experience packages sold out by 1300 hours. The creature from Enclosure 7 — if it was ever out — generated fifteen visitor testimonials that are already circulating on public networks. Dr. Ylss looks at the numbers and then looks at you. "Do you want a job?"',
      image: '/quests/xenolog_01.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
  },
};

const QUEST_SMUGGLERS_RUN: TextQuest = {
  id: 'smugglers_run',
  title: "Smuggler's Run",
  description: "High-value cargo, restricted space, and enough credits to fund a ship refit. The job is simple: pick up, deliver, don't get caught. You've done harder things. Probably.",
  image: '/quests/drugs_00.jpg',
  difficulty: 'medium',
  estimatedTime: '5 min',
  startNode: 'start',
  variables: { cargo: 10, suspicion: 0, credits: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'The contact is a Peleng in a very loud jacket who introduces himself only as "Flick." The cargo: ten crates of unspecified "cultural artifacts" — which, based on the weight, either contain rare sculptures or something considerably less legal. The route goes through two Patrol checkpoints and a sector the pirates currently consider personal property. The payment is excellent. The timeline is tight. Flick slides the manifest across the table and taps it twice. "Clean run. No questions. Deliver by 0600."',
      image: '/quests/drugs_00.jpg',
      choices: [
        { text: 'Take the job — check the manifest carefully', nextNode: 'check_manifest' },
        { text: 'Take the job and ask no questions', nextNode: 'load_cargo', effects: [{ variable: 'credits', op: '+', value: 100 }] },
        { text: 'Negotiate a higher fee before agreeing', nextNode: 'negotiate_fee' },
      ],
    },
    check_manifest: {
      id: 'check_manifest',
      text: 'The manifest lists the cargo as "Archival Media — Pre-Collapse" with an authenticity certificate signed by someone named Professor Deet of the Galactic Museum. Professor Deet, you happen to know, retired eleven years ago and does not sign certificates anymore because he has been legally dead for eight of them. The cargo might still be legitimate. It is probably not legitimate. You know this. You load it anyway.',
      image: '/quests/drugs_01.jpg',
      choices: [
        { text: 'Install a hidden compartment — takes an hour but reduces risk', nextNode: 'hidden_compartment', effects: [{ variable: 'suspicion', op: '-', value: 1 }] },
        { text: 'Just go — time is tight', nextNode: 'first_checkpoint' },
      ],
    },
    negotiate_fee: {
      id: 'negotiate_fee',
      text: 'Flick stares at you. He scratches his chin. He checks his communicator. He stares at you again. "Fine," he says. "But if you\'re late, the bonus comes off, not the base." You consider this a victory. Flick considers it a test of whether you\'ll actually deliver. Both assessments are probably correct.',
      image: '/quests/drugs_02.jpg',
      choices: [
        { text: 'Load up and head out', nextNode: 'load_cargo', effects: [{ variable: 'credits', op: '+', value: 200 }] },
      ],
    },
    load_cargo: {
      id: 'load_cargo',
      text: 'The crates load smoothly. Ten of them, each sealed with a biometric lock you can\'t open even if you wanted to — which you don\'t. You calculate the route: the Orvan Corridor is fastest but has two Patrol stations. The Outer Loop adds four hours but avoids official checkpoints. The pirate lane cuts through the Tannex Nebula — fast, but the pirates there charge a toll in cargo, not credits.',
      image: '/quests/drugs_03.jpg',
      choices: [
        { text: 'Take the Orvan Corridor — fast but risky', nextNode: 'first_checkpoint' },
        { text: 'Take the Outer Loop — slow but clean', nextNode: 'outer_loop' },
        { text: 'Head through the Tannex Nebula — pirate territory', nextNode: 'pirate_territory' },
      ],
    },
    hidden_compartment: {
      id: 'hidden_compartment',
      text: 'One hour of careful work later, the cargo is distributed across your ship\'s secondary storage in a configuration that reads as empty on standard scans. It took longer than planned. It was worth it. The manifest shows only "personal effects." You head for the Orvan Corridor feeling considerably calmer about the checkpoints.',
      image: '/quests/drugs_04.jpg',
      choices: [
        { text: 'Proceed through the Orvan Corridor', nextNode: 'first_checkpoint' },
      ],
    },
    outer_loop: {
      id: 'outer_loop',
      text: 'The long way. Empty space, no checkpoints, no pirates, and absolutely nothing interesting for four hours. You listen to archives and eat travel rations. At hour three, a distress signal appears on your scanner — a small freighter, apparently stricken. Responding will cost time. Ignoring it will cost something else.',
      image: '/quests/depth_submarine.jpg',
      choices: [
        { text: 'Respond to the distress signal', nextNode: 'distress_signal', effects: [{ variable: 'suspicion', op: '+', value: 1 }] },
        { text: 'Log the signal and keep moving', nextNode: 'final_delivery', effects: [{ variable: 'credits', op: '+', value: 100 } ] },
      ],
    },
    first_checkpoint: {
      id: 'first_checkpoint',
      text: 'The first Patrol checkpoint is routine — a standard Class-3 scanner and two officers who look like they\'d rather be anywhere else. They run your ID, scan your hold, and ask what you\'re carrying. Your answer needs to be convincing. Your manifest says "archival media." Your hidden compartment either works or it doesn\'t.',
      image: '/quests/drugs_05.jpg',
      choices: [
        { text: 'Present the manifest calmly', nextNode: 'pass_checkpoint', skillCheck: { stat: 'luck', min: 55 } },
        { text: 'Offer to open the hold for manual inspection — call their bluff', nextNode: 'bluff_inspection' },
        { text: 'Outrun them if they flag you', nextNode: 'run_checkpoint', skillCheck: { stat: 'speed', min: 45 } },
      ],
    },
    pirate_territory: {
      id: 'pirate_territory',
      text: 'The Tannex Nebula is exactly as ominous as it sounds — a churning red cloud shot through with electromagnetic interference. Three pirate interceptors emerge from the static within minutes. Their hail is direct: "Toll. One crate from your cargo. Take it or we take it plus the ship." They\'ve done this before. So have you.',
      image: '/quests/penetrator_pirate.jpg',
      choices: [
        { text: 'Pay the toll — one crate is acceptable losses', nextNode: 'pay_toll', effects: [{ variable: 'cargo', op: '-', value: 1 }] },
        { text: 'Fight your way through', nextNode: 'fight_pirates', skillCheck: { stat: 'firepower', min: 40 } },
        { text: 'Negotiate — you know how pirates think', nextNode: 'negotiate_pirates' },
      ],
    },
    pass_checkpoint: {
      id: 'pass_checkpoint',
      text: 'The scanner runs. A long pause. The officer looks at his screen. The screen looks clean. He hands your documents back without comment and waves you through. You maintain a perfectly reasonable speed until the checkpoint is out of scanner range.',
      image: '/quests/drugs_05.jpg',
      choices: [
        { text: 'Continue to the second checkpoint', nextNode: 'second_checkpoint' },
      ],
    },
    bluff_inspection: {
      id: 'bluff_inspection',
      text: 'Opening the hold is a gamble. But the hidden compartment is good work. The officer walks through, taps crates, sweeps a handheld scanner, and finds nothing but your declared personal effects and the (empty) cargo bay. "Clean," he reports. You smile appropriately. "Always is." He doesn\'t smile back, but he clears you through.',
      image: '/quests/drugs_04.jpg',
      choices: [
        { text: 'Continue to the second checkpoint', nextNode: 'second_checkpoint' },
      ],
    },
    run_checkpoint: {
      id: 'run_checkpoint',
      text: 'The moment they start to flag you, you gun the engines. Your ship surges away before their weapons lock. They broadcast an alert — your registration is flagged in this sector for thirty days. But you\'re through, uncaught, and the Corridor is wide. Suspicion is up. You need the rest of this run to go cleaner.',
      image: '/quests/drugs_05.jpg',
      choices: [
        { text: 'Push through to delivery — no more stops', nextNode: 'second_checkpoint', effects: [{ variable: 'suspicion', op: '+', value: 2 }] },
      ],
    },
    second_checkpoint: {
      id: 'second_checkpoint',
      text: 'The second checkpoint is heavier — a full Patrol cruiser with four officers and a dedicated cargo scanner. One officer checks a list. Your name might be on it. It depends on whether the first checkpoint filed their report yet.',
      image: '/quests/drugs_05.jpg',
      choices: [
        { text: 'Go through normally — suspicion decides', nextNode: 'suspicion_check' },
        { text: 'Divert through the nebula edge — avoid checkpoint entirely', nextNode: 'nebula_divert', effects: [{ variable: 'suspicion', op: '+', value: 1 }] },
      ],
    },
    suspicion_check: {
      id: 'suspicion_check',
      text: 'The officer runs your ID. His expression shifts slightly — the kind of shift that means something came up on the screen.',
      image: '/quests/drugs_04.jpg',
      choices: [
        { text: 'High suspicion — they detain you', nextNode: 'ending_caught', condition: { variable: 'suspicion', op: '>=', value: 3 } },
        { text: 'Low suspicion — cleared through', nextNode: 'final_delivery', condition: { variable: 'suspicion', op: '<=', value: 2 } },
      ],
    },
    distress_signal: {
      id: 'distress_signal',
      text: 'The stricken freighter is crewed by a single Gaalsian pilot whose navigation system failed. She needs a navigation patch, which takes twenty minutes to install. She offers to pay. You wave it off — partly from goodwill, partly because she works for a shipping company that moves through these lanes regularly. Good contacts are worth more than small fees.',
      image: '/quests/pilot_00.jpg',
      choices: [
        { text: 'Continue to delivery — you\'re now running late', nextNode: 'final_delivery', effects: [{ variable: 'credits', op: '-', value: 50 } ] },
      ],
    },
    nebula_divert: {
      id: 'nebula_divert',
      text: 'The nebula edge is rough — sensor ghosts, hull vibration, one tense minute where something large and unlit moves through the static nearby. But you\'re through the second checkpoint\'s range without ever triggering their scanners. A clean divert. You are late by 40 minutes.',
      image: '/quests/depth_submarine.jpg',
      choices: [
        { text: 'Push to the delivery point at maximum speed', nextNode: 'final_delivery', skillCheck: { stat: 'speed', min: 45 } },
        { text: 'Arrive on time regardless', nextNode: 'final_delivery' },
      ],
    },
    pay_toll: {
      id: 'pay_toll',
      text: 'The pirates take one crate. They open it, inspect the contents with the detached professionalism of people who have assessed many questionable cargoes, and seem satisfied. "Pass." They close the channel. You pass. Nine crates remain. Delivery is technically still viable — the client needs at least five.',
      image: '/quests/drugs_03.jpg',
      choices: [
        { text: 'Continue to the delivery point', nextNode: 'final_delivery' },
      ],
    },
    fight_pirates: {
      id: 'fight_pirates',
      text: 'Your weapons open up into the lead interceptor before they have time to respond. The nebula works in your favor — they can\'t coordinate properly through the interference. Two disable and retreat. One makes a run at you and takes a solid hit from your rear cannon. You\'re through, with minor hull damage and your cargo intact.',
      image: '/quests/battle_army.jpg',
      choices: [
        { text: 'Press on to delivery', nextNode: 'final_delivery', effects: [{ variable: 'credits', op: '+', value: 50 }] },
      ],
    },
    negotiate_pirates: {
      id: 'negotiate_pirates',
      text: 'The pirate commander narrows his eyes. "Information or cargo," he growls. "Your choice." You could share Patrol patrol patterns from the checkpoints — or just sell him the cargo right here for quick credits, cutting out the middleman.',
      image: '/quests/drugs_02.jpg',
      choices: [
        { text: 'Trade intel for safe passage', nextNode: 'final_delivery' },
        { text: 'Sell the cargo to pirates instead', nextNode: 'ending_sold_to_pirates', effects: [{ variable: 'cargo', op: '=', value: 0 }, { variable: 'credits', op: '+', value: 200 }] },
      ],
    },
    final_delivery: {
      id: 'final_delivery',
      text: 'The delivery point is a private dock on a station the maps call Waypoint-7. Flick is there. He counts the crates. He checks the seals. He nods once.',
      image: '/quests/drugs_01.jpg',
      choices: [
        { text: 'Full cargo delivered clean — collect the big payout', nextNode: 'ending_legendary', condition: { variable: 'cargo', op: '>=', value: 5 } },
        { text: 'Caught and searched — job failed', nextNode: 'ending_caught', condition: { variable: 'suspicion', op: '>=', value: 3 } },
        { text: 'Partial cargo, clean delivery', nextNode: 'ending_clean_delivery' },
      ],
    },
    ending_clean_delivery: {
      id: 'ending_clean_delivery',
      text: 'All ten crates delivered, no Patrol incidents, no pirate complications, no questions asked and none answered. Flick pays you in hard credits — no traceable transfer. "Good work," he says. "Fast, quiet, no drama." You take that as the highest compliment this business offers, which it is.',
      image: '/quests/drugs_00.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_caught: {
      id: 'ending_caught',
      text: 'The Patrol cruiser pulls you over at the second checkpoint. They bring a specialized cargo scanner. The hidden compartment is good — but not good enough for specialized equipment. They confiscate everything: cargo, the deposit Flick already paid, and three hours of your life. You are released with a formal warning and a notation on your record. Flick does not return your calls. A lesson in the value of better hardware.',
      image: '/quests/drugs_05.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 0 },
    },
    ending_sold_to_pirates: {
      id: 'ending_sold_to_pirates',
      text: 'You negotiate with the Tannex pirates so well that they make you a counter-offer: sell them the whole cargo at 30% above Flick\'s rate, right now, cash. No Patrol risk. No checkpoints. You think about Flick\'s jacket. You think about the Peleng Syndicate\'s documented attitudes toward contract breakers. Then you think about 30% above rate. "Done," you say. You are now, technically, also a fence.',
      image: '/quests/penetrator_pirate.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_legendary: {
      id: 'ending_legendary',
      text: 'Ten crates. Both checkpoints. Pirate territory. Delivered on time with no incidents and no record. Flick counts the delivery confirmation twice and then looks at you with something approaching genuine respect. "I\'ve had teams of four who couldn\'t run this clean." He pays the full amount plus the negotiated bonus. Your name — whatever name you gave him — will be passed along quietly to people who pay well for discretion. You have just entered a very exclusive professional category.',
      image: '/quests/drugs_00.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 1000 },
    },
  },
};

export const TEXT_QUEST_DATA: TextQuest[] = [
  QUEST_ABANDONED_STATION,
  QUEST_PIRATE_AMBUSH,
  QUEST_DARK_MATTER,
  QUEST_PRISON_BREAK,
  QUEST_DOMINATOR_FACTORY,
  QUEST_ELECTION_DAY,
  QUEST_ALIEN_ZOO,
  QUEST_SMUGGLERS_RUN,
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
