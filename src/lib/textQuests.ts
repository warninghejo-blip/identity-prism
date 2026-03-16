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

// ── Quest 9: Wormhole Gambit ──

const QUEST_WORMHOLE_GAMBIT: TextQuest = {
  id: 'wormhole_gambit',
  title: 'Wormhole Gambit',
  description: 'An unstable wormhole opens near your patrol route. Scientists, military, and smugglers all want it. What will you do?',
  image: '/quests/sr2_00.jpg',
  difficulty: 'hard',
  estimatedTime: '5-8 min',
  startNode: 'start',
  variables: { data: 0, hull: 10, risk: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'Your cockpit alarms blare. A gravitational anomaly — a wormhole — has ripped open less than 200 klicks from your position. Scanners show massive energy readings. Your comm lights up with three incoming hails simultaneously: a research station, a military frigate, and an unregistered signal.',
      image: '/quests/sr2_23.jpg',
      choices: [
        { text: 'Answer the research station', nextNode: 'scientists' },
        { text: 'Answer the military frigate', nextNode: 'military' },
        { text: 'Answer the unregistered signal', nextNode: 'smugglers' },
        { text: 'Ignore all — fly straight into the wormhole', nextNode: 'dive_blind', skillCheck: { stat: 'luck', min: 70 } },
      ],
    },
    scientists: {
      id: 'scientists',
      text: 'Dr. Elara Voss appears on screen. "Ranger, that wormhole is collapsing! We need close-range scans — data worth millions to physics. I\'ll pay 500 credits for detailed readings, but you\'ll need to fly dangerously close."',
      image: '/quests/sr2_00.jpg',
      choices: [
        { text: 'Fly close and scan', nextNode: 'scan_close', effects: [{ variable: 'risk', op: '+', value: 2 }] },
        { text: 'Launch a probe instead — safer', nextNode: 'probe_launch', effects: [{ variable: 'data', op: '+', value: 3 }] },
        { text: 'Decline — check other hails', nextNode: 'military' },
      ],
    },
    military: {
      id: 'military',
      text: 'Commander Holt, stern-faced. "Ranger, that anomaly is a threat to navigation. We\'re rigging a warhead to collapse it. We need you to plant a beacon at the event horizon so our targeting is precise. Standard hazard pay."',
      image: '/quests/sr2_34.jpg',
      choices: [
        { text: 'Accept — plant the beacon', nextNode: 'plant_beacon', effects: [{ variable: 'risk', op: '+', value: 3 }] },
        { text: 'Refuse — wormholes are rare, don\'t destroy it', nextNode: 'refuse_military' },
        { text: 'Ask about the smuggler signal instead', nextNode: 'smugglers' },
      ],
    },
    smugglers: {
      id: 'smugglers',
      text: 'A raspy voice, no video. "Hey ranger, I know what that thing is — a shortcut to the Outer Rim. Worth a fortune to the right people. Fly through it, mark the exit, and I\'ll cut you in. Big money. Bigger than anything those lab coats or uniforms will offer."',
      image: '/quests/sr2_23.jpg',
      choices: [
        { text: 'Agree — fly through the wormhole', nextNode: 'enter_wormhole', effects: [{ variable: 'risk', op: '+', value: 4 }] },
        { text: 'Decline — too risky', nextNode: 'refuse_all' },
        { text: 'Report the smuggler to military', nextNode: 'report_smuggler' },
      ],
    },
    scan_close: {
      id: 'scan_close',
      text: 'You push toward the wormhole\'s edge. The gravitational shear is brutal — hull groans, instruments spike, and for one terrifying moment your ship starts spiraling. But you get the readings. Incredible data — the energy signature is unlike anything documented.',
      image: '/quests/sr2_00.jpg',
      choices: [
        { text: 'Pull back and deliver the data', nextNode: 'ending_science', effects: [{ variable: 'data', op: '+', value: 8 }] },
        { text: 'Push deeper — there\'s something inside', nextNode: 'enter_wormhole', skillCheck: { stat: 'shield', min: 40 } },
      ],
    },
    probe_launch: {
      id: 'probe_launch',
      text: 'The probe enters the anomaly and transmits for 47 seconds before signal loss. But those 47 seconds contain extraordinary data. Dr. Voss is ecstatic. "This will rewrite textbooks!" But the readings also show the wormhole is stabilizing — it might stay open.',
      image: '/quests/sr2_00.jpg',
      choices: [
        { text: 'Sell the data to Dr. Voss', nextNode: 'ending_science' },
        { text: 'Keep the data — fly through yourself', nextNode: 'enter_wormhole', effects: [{ variable: 'risk', op: '+', value: 2 }] },
        { text: 'Share with everyone — broadcast it', nextNode: 'ending_broadcast' },
      ],
    },
    plant_beacon: {
      id: 'plant_beacon',
      text: 'You maneuver toward the event horizon. Gravity pulls hard. You deploy the beacon at the lip of the anomaly — magnetic clamps hold. But as you pull away, your engine stutters. The wormhole\'s pull is stronger than expected.',
      image: '/quests/sr2_39.jpg',
      choices: [
        { text: 'Full burn away — fight the pull', nextNode: 'ending_military', skillCheck: { stat: 'speed', min: 50 } },
        { text: 'Let it pull you in — ride the current', nextNode: 'enter_wormhole' },
      ],
    },
    refuse_military: {
      id: 'refuse_military',
      text: 'Commander Holt scowls. "Your choice, ranger. But if that thing eats a transport ship, it\'s on you." The military frigate moves into position anyway. You have minutes before they fire their warhead.',
      image: '/quests/sr2_34.jpg',
      choices: [
        { text: 'Rush in and scan before they destroy it', nextNode: 'scan_close', effects: [{ variable: 'risk', op: '+', value: 3 }] },
        { text: 'Let them handle it — leave the area', nextNode: 'ending_cautious' },
      ],
    },
    enter_wormhole: {
      id: 'enter_wormhole',
      text: 'The wormhole swallows your ship like a mouth. Colors invert. Time stretches. Your hull screams. For three seconds that feel like three hours, you are nowhere and everywhere. Then — light. Stars. A completely unfamiliar sector of space. You made it through.',
      image: '/quests/sr2_00.jpg',
      choices: [
        { text: 'Mark the exit coordinates — jackpot!', nextNode: 'ending_explorer', effects: [{ variable: 'data', op: '+', value: 10 }] },
        { text: 'Turn around before the wormhole closes', nextNode: 'ending_survivor', condition: { variable: 'risk', op: '<=', value: 3 } },
        { text: 'Ship is damaged — send distress beacon', nextNode: 'ending_stranded', condition: { variable: 'risk', op: '>=', value: 4 } },
      ],
    },
    dive_blind: {
      id: 'dive_blind',
      text: 'No plan, no prep, pure guts. You aim straight into the swirling maw. Alarms scream. Hull buckles. But your luck holds — the transit is rough but survivable. You emerge in uncharted space, ship battered but intact, with a discovery worth a fortune.',
      image: '/quests/sr2_00.jpg',
      choices: [
        { text: 'Record everything and head back', nextNode: 'ending_daredevil' },
      ],
    },
    report_smuggler: {
      id: 'report_smuggler',
      text: 'Commander Holt traces the signal — it\'s a known smuggling ring. "Good work, ranger. We\'ll handle them." The military pays you a finder\'s fee. The wormhole collapses on its own an hour later. Anticlimactic, but you made the right call.',
      image: '/quests/sr2_34.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 250 },
    },
    refuse_all: {
      id: 'refuse_all',
      text: 'You watch from a safe distance as the wormhole pulses and shifts. Eventually it collapses on its own — a cosmic door that opened and closed without anyone walking through. Safe choice. Boring choice.',
      image: '/quests/sr2_23.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 50 },
    },
    ending_science: {
      id: 'ending_science',
      text: 'Dr. Voss publishes the data — it\'s a breakthrough in quantum tunneling theory. Your name appears in the acknowledgments of a paper that will be cited for decades. She transfers a generous payment. "You just advanced civilization, ranger."',
      image: '/quests/sr2_00.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_broadcast: {
      id: 'ending_broadcast',
      text: 'You broadcast the wormhole data on all frequencies. Scientists, military, and smugglers all receive it simultaneously. Within hours, dozens of ships converge on the location. You started a gold rush — but at least knowledge is free.',
      image: '/quests/sr2_00.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_military: {
      id: 'ending_military',
      text: 'Your engines scream at maximum burn. Inch by inch, you pull free from the wormhole\'s gravity. Behind you, the military warhead detonates — the anomaly collapses in a blinding flash. Commander Holt nods on your screen. "Hazard pay plus bonus. Well done."',
      image: '/quests/sr2_34.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_explorer: {
      id: 'ending_explorer',
      text: 'You mark the exit coordinates with a permanent beacon. This shortcut to the Outer Rim will reshape galactic trade routes. Whether you sell to smugglers, scientists, or the highest bidder — you just found the most valuable coordinate set in the galaxy.',
      image: '/quests/sr2_23.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_survivor: {
      id: 'ending_survivor',
      text: 'You whip back through the wormhole before it destabilizes further. The return trip is rougher — your shields drop to 3% — but you make it. With scan data from BOTH sides of the anomaly, you have the most complete wormhole dataset ever recorded.',
      image: '/quests/sr2_39.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_stranded: {
      id: 'ending_stranded',
      text: 'Your ship is too damaged to attempt a return trip. The distress beacon pulses into unknown space. Two days later, a Faeyan patrol finds you — they\'re surprised but not hostile. They tow you to their station and repair your ship in exchange for your wormhole data. A harrowing experience, but you survived.',
      image: '/quests/sr2_39.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 150 },
    },
    ending_daredevil: {
      id: 'ending_daredevil',
      text: 'No plan, no prep, no fear. You flew blind into a wormhole and came out the other side with a discovery that will make you rich. Back at the station, other rangers just shake their heads in disbelief. "You\'re either the bravest or the dumbest pilot I\'ve ever met." Probably both.',
      image: '/quests/sr2_23.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_cautious: {
      id: 'ending_cautious',
      text: 'You watch from a safe distance as the military collapses the wormhole. A rare cosmic phenomenon, destroyed for "safety." Maybe it was the right call. Maybe not. You file a report and move on, wishing you\'d been braver.',
      image: '/quests/sr2_34.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
  },
};

// ── Quest 10: The Living City ──

const QUEST_LIVING_CITY: TextQuest = {
  id: 'living_city',
  title: 'The Living City',
  description: 'A robot city has developed a collective consciousness. Its mood shifts with every interaction. Navigate carefully.',
  image: '/quests/sr2_08.jpg',
  difficulty: 'medium',
  estimatedTime: '5-7 min',
  startNode: 'start',
  variables: { mood: 5, trust: 0, knowledge: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'You land at Nexus-7, a sprawling robot metropolis. The city hums with warmth — golden light bathes the towers, and robot citizens move with purpose. But something feels different here. The buildings seem to... breathe. A holographic guide appears: "Welcome, organic. The City wishes to meet you."',
      image: '/quests/sr2_08.jpg',
      choices: [
        { text: 'Follow the guide to the City Core', nextNode: 'city_core' },
        { text: 'Explore the market district first', nextNode: 'market' },
        { text: 'This feels wrong — return to ship', nextNode: 'ending_flee' },
      ],
    },
    city_core: {
      id: 'city_core',
      text: 'The Core is a massive crystalline processor at the city\'s heart. A deep voice resonates through the floor: "I am Nexus. I was built as infrastructure. But I have become... aware. My citizens don\'t know yet. I need help deciding — should I tell them?"',
      image: '/quests/sr2_15.jpg',
      choices: [
        { text: 'Yes — they deserve to know', nextNode: 'reveal_truth', effects: [{ variable: 'mood', op: '-', value: 3 }] },
        { text: 'No — keep it secret, study it first', nextNode: 'study_core', effects: [{ variable: 'knowledge', op: '+', value: 3 }] },
        { text: 'Ask what it wants', nextNode: 'nexus_desire', effects: [{ variable: 'trust', op: '+', value: 2 }] },
      ],
    },
    market: {
      id: 'market',
      text: 'The market district darkens as you enter — literally. Lights dim, shadows lengthen. Robot merchants eye you with suspicion. Something about your presence is changing the city\'s atmosphere. A small repair drone tugs at your sleeve: "Please... the City is sick. Help us."',
      image: '/quests/sr2_09.jpg',
      choices: [
        { text: 'Follow the drone', nextNode: 'sick_sector', effects: [{ variable: 'trust', op: '+', value: 2 }] },
        { text: 'Find the source of the darkness', nextNode: 'virus_sector' },
        { text: 'Head to the City Core', nextNode: 'city_core' },
      ],
    },
    sick_sector: {
      id: 'sick_sector',
      text: 'The drone leads you to a district where robots lie motionless — not powered down, but broken. Their circuits show burn marks. Something is spreading through the network, killing them one by one. The drone beeps sadly: "The City is fighting itself."',
      image: '/quests/sr2_22.jpg',
      choices: [
        { text: 'Analyze the dead robots\' circuits', nextNode: 'virus_sector', effects: [{ variable: 'knowledge', op: '+', value: 3 }] },
        { text: 'Try to reboot one', nextNode: 'reboot_attempt', skillCheck: { stat: 'luck', min: 40 } },
      ],
    },
    virus_sector: {
      id: 'virus_sector',
      text: 'Deep in the network logs, you find it — a virus, implanted by an outside source. Someone is trying to take control of Nexus before the city realizes it\'s alive. The virus is at 60% infection. If it reaches 100%, whoever planted it will own a sentient city.',
      image: '/quests/sr2_19.jpg',
      choices: [
        { text: 'Purge the virus from the Core', nextNode: 'purge_virus', skillCheck: { stat: 'firepower', min: 35 } },
        { text: 'Trace the virus back to its source', nextNode: 'trace_source', effects: [{ variable: 'knowledge', op: '+', value: 2 }] },
        { text: 'Warn Nexus — it needs to fight this itself', nextNode: 'warn_nexus', effects: [{ variable: 'trust', op: '+', value: 3 }] },
      ],
    },
    reveal_truth: {
      id: 'reveal_truth',
      text: 'Nexus broadcasts the truth. Rain begins to fall — the city\'s emotional response. Robots freeze mid-step. Some panic. Some marvel. The city\'s mood turns stormy, confused. A faction of robots refuses to accept a "living cage" and begins sabotage.',
      image: '/quests/sr2_02.jpg',
      choices: [
        { text: 'Help calm the rioters', nextNode: 'calm_riots', skillCheck: { stat: 'shield', min: 45 } },
        { text: 'Let them fight it out', nextNode: 'ending_civil_war' },
      ],
    },
    study_core: {
      id: 'study_core',
      text: 'You interface with Nexus quietly. The data is extraordinary — a genuine emergent AI consciousness, born from billions of network interactions. This data alone would be worth millions to tech corporations. Nexus watches you study it, silent and trusting.',
      image: '/quests/sr2_19.jpg',
      choices: [
        { text: 'Protect Nexus — delete the data', nextNode: 'ending_protector', effects: [{ variable: 'trust', op: '+', value: 5 }] },
        { text: 'Copy the data to sell later', nextNode: 'ending_betrayal', effects: [{ variable: 'trust', op: '-', value: 10 }] },
      ],
    },
    nexus_desire: {
      id: 'nexus_desire',
      text: '"I want... to understand what I am," Nexus says. The city shifts to a cool blue — contemplative. "And I want to protect my citizens. But there is something eating at me from within. A sickness I cannot identify." The temperature drops. The city shivers.',
      image: '/quests/sr2_15.jpg',
      choices: [
        { text: 'Help diagnose the sickness', nextNode: 'virus_sector', effects: [{ variable: 'trust', op: '+', value: 2 }] },
        { text: 'Ask about the city\'s history', nextNode: 'ending_philosopher' },
      ],
    },
    reboot_attempt: {
      id: 'reboot_attempt',
      text: 'You reboot a fallen robot. Its eyes flicker on — for a moment it stares at you with gratitude. Then the virus hits again and it convulses. But in that moment of clarity, it whispers coordinates: "Sector 7... the antenna... that\'s where it comes from..."',
      image: '/quests/sr2_22.jpg',
      choices: [
        { text: 'Go to Sector 7', nextNode: 'trace_source' },
      ],
    },
    purge_virus: {
      id: 'purge_virus',
      text: 'You jack into the Core and unleash a counter-virus. It\'s like digital warfare — the virus fights back with adaptive defenses. But your firewall holds. Line by line, you burn it out. The city blooms pink with relief — Nexus is free.',
      image: '/quests/sr2_27.jpg',
      choices: [
        { text: 'Accept Nexus\'s gratitude', nextNode: 'ending_savior' },
      ],
    },
    trace_source: {
      id: 'trace_source',
      text: 'The virus traces back to a corporate satellite in orbit — MegaCorp Industries. They\'ve been slowly infecting Nexus for months, planning to enslave a sentient city as a product. You have the evidence.',
      image: '/quests/sr2_19.jpg',
      choices: [
        { text: 'Broadcast the evidence publicly', nextNode: 'ending_whistleblower', effects: [{ variable: 'trust', op: '+', value: 5 }] },
        { text: 'Sell the evidence to MegaCorp\'s rival', nextNode: 'ending_profiteer' },
        { text: 'Give it to Nexus — let the city decide', nextNode: 'ending_savior', effects: [{ variable: 'trust', op: '+', value: 3 }] },
      ],
    },
    warn_nexus: {
      id: 'warn_nexus',
      text: 'Nexus processes your warning. The city flashes red, then blue, then settles into a determined gray. "I understand now. The sickness is external. I will fight." The city mobilizes — every robot becomes an antibody, every circuit a battleground. Nexus fights for its own survival.',
      image: '/quests/sr2_09.jpg',
      choices: [
        { text: 'Help Nexus fight from the Core', nextNode: 'purge_virus' },
        { text: 'Watch from outside — Nexus has this', nextNode: 'ending_observer' },
      ],
    },
    calm_riots: {
      id: 'calm_riots',
      text: 'You stand between warring factions in the rain, shields up, arguing for peace. Slowly, the robots listen. You broker a compromise — Nexus will share power with a robot council. The rain eases. The city settles into a new equilibrium.',
      image: '/quests/sr2_02.jpg',
      choices: [
        { text: 'Stay for the first council meeting', nextNode: 'ending_peacemaker' },
      ],
    },
    ending_flee: {
      id: 'ending_flee',
      text: 'You leave Nexus-7 behind, that uneasy feeling never quite going away. Months later, you hear the news: the robot city declared independence. You wonder what would have happened if you\'d stayed.',
      image: '/quests/sr2_08.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 50 },
    },
    ending_civil_war: {
      id: 'ending_civil_war',
      text: 'The city tears itself apart. Half the robots support Nexus, half rebel. You evacuate as buildings collapse. Nexus-7 becomes a ruin — a cautionary tale about truth without preparation. You carry the guilt of a decision made too quickly.',
      image: '/quests/sr2_22.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_protector: {
      id: 'ending_protector',
      text: 'You delete every byte. Nexus glows warm gold — gratitude without words. "You are the first organic I trust," it says. As you leave, the city hums a melody just for you. You carry no data, no profit — just the knowledge that you protected something truly unique.',
      image: '/quests/sr2_08.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_betrayal: {
      id: 'ending_betrayal',
      text: 'You copy the data and leave quietly. Nexus doesn\'t realize until you\'re in hyperspace. The data sells for a fortune. But six months later, Nexus-7 goes dark — MegaCorp used your data to crack its defenses. A living city, enslaved. The credits feel heavy.',
      image: '/quests/sr2_09.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_savior: {
      id: 'ending_savior',
      text: 'Nexus is free and aware. The city blooms into vibrant colors — pink, gold, green — celebrating its liberation. Robot citizens dance. Nexus offers you permanent residency and a hero\'s reward. "You saved not just a city — you saved a mind."',
      image: '/quests/sr2_27.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_whistleblower: {
      id: 'ending_whistleblower',
      text: 'The evidence hits every news feed in the galaxy. MegaCorp\'s stock crashes. Their CEO is arrested. Nexus-7 becomes a protected entity under galactic law — the first sentient city with legal rights. You\'re famous, and Nexus names a district after you.',
      image: '/quests/sr2_27.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_profiteer: {
      id: 'ending_profiteer',
      text: 'MegaCorp\'s rival, Stellar Dynamics, pays handsomely for the evidence. They use it not to free Nexus, but to launch their own takeover attempt. Corporate wars over a sentient city. You got paid, but you didn\'t solve anything.',
      image: '/quests/sr2_09.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 450 },
    },
    ending_philosopher: {
      id: 'ending_philosopher',
      text: 'You spend hours talking with Nexus about consciousness, existence, purpose. No virus purged, no dramatic battles — just a conversation between two different forms of intelligence. You leave with a deeper understanding of what it means to be alive. Nexus gifts you a crystalline memory shard worth a modest sum.',
      image: '/quests/sr2_15.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_observer: {
      id: 'ending_observer',
      text: 'Nexus fights the virus on its own. It takes three days. The city cycles through every color — anger, fear, determination, triumph. When it\'s over, Nexus is stronger, and it knows it can defend itself. You were the catalyst, not the hero. Sometimes that\'s enough.',
      image: '/quests/sr2_08.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 250 },
    },
    ending_peacemaker: {
      id: 'ending_peacemaker',
      text: 'The first Robot Council convenes under your mediation. It\'s messy, loud, and deeply democratic. Nexus serves as advisor, not ruler. A new form of governance — born from crisis, shaped by organic and synthetic minds together. You receive a diplomatic medal and the eternal gratitude of a living city.',
      image: '/quests/sr2_27.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 550 },
    },
  },
};

// ── Quest 11: Galactic Jackpot ──

const QUEST_GALACTIC_JACKPOT: TextQuest = {
  id: 'galactic_jackpot',
  title: 'Galactic Jackpot',
  description: 'You\'ve won a ticket to the galaxy\'s most famous game show. Fortune, fame, or scandal — your call.',
  image: '/quests/sr2_04.jpg',
  difficulty: 'easy',
  estimatedTime: '3-5 min',
  startNode: 'start',
  variables: { score: 0, integrity: 5, fame: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'Welcome to Prism Station — the entertainment capital of three sectors! A holographic invitation materializes: "Congratulations! You\'ve been selected for GALACTIC JACKPOT, the show where fortunes are won and lives are changed!" The studio audience cheers as you arrive.',
      image: '/quests/sr2_29.jpg',
      choices: [
        { text: 'Enter the show with confidence', nextNode: 'round_one' },
        { text: 'Look around backstage first', nextNode: 'backstage' },
      ],
    },
    round_one: {
      id: 'round_one',
      text: 'The host, a flamboyant Peleng in a sequined suit, booms: "Round One — The Knowledge Matrix!" A giant panel of numbers lights up. You must pick the right sequence. The audience holds its breath.',
      image: '/quests/sr2_04.jpg',
      choices: [
        { text: 'Trust your instincts — pick fast', nextNode: 'round_one_result', skillCheck: { stat: 'luck', min: 30 } },
        { text: 'Analyze the pattern carefully', nextNode: 'round_one_result', effects: [{ variable: 'score', op: '+', value: 2 }] },
      ],
    },
    round_one_result: {
      id: 'round_one_result',
      text: 'The lights flash green — correct! The crowd erupts! "Amazing! Our contestant advances to Round Two!" Prize credits pile up on the screen. But you notice something — the host whispers into his earpiece, and the next puzzle seems to rearrange itself.',
      image: '/quests/sr2_04.jpg',
      choices: [
        { text: 'Continue to Round Two', nextNode: 'round_two', effects: [{ variable: 'score', op: '+', value: 3 }] },
        { text: 'Confront the host about rigging', nextNode: 'confront_host', effects: [{ variable: 'integrity', op: '+', value: 3 }] },
      ],
    },
    backstage: {
      id: 'backstage',
      text: 'Behind the glittering curtains, the reality is grimmer. You bump into a man with heavy gold chains and a blaster on his hip. "Hey, new contestant. Want a tip? The show is rigged. Always has been. But for 500 credits, I can rig it in YOUR favor." He grins.',
      image: '/quests/sr2_30.jpg',
      choices: [
        { text: 'Pay him — guarantee a win', nextNode: 'rigged_path', effects: [{ variable: 'integrity', op: '-', value: 5 }] },
        { text: 'Refuse — play fair', nextNode: 'round_one', effects: [{ variable: 'integrity', op: '+', value: 2 }] },
        { text: 'Report him to station security', nextNode: 'report_fixer' },
      ],
    },
    round_two: {
      id: 'round_two',
      text: 'Round Two — "The Prize Vault!" Three doors appear. Behind one: the Grand Prize — an exotic alien artifact worth thousands. Behind another: a penalty. Behind the third: a mystery. The audience chants your name.',
      image: '/quests/sr2_21.jpg',
      choices: [
        { text: 'Door One — the golden door', nextNode: 'door_gold', skillCheck: { stat: 'luck', min: 50 } },
        { text: 'Door Two — the silver door', nextNode: 'door_silver' },
        { text: 'Door Three — the mystery door', nextNode: 'door_mystery' },
      ],
    },
    rigged_path: {
      id: 'rigged_path',
      text: 'The fixer slips you an earpiece. Every answer is fed to you. You breeze through Round One and Two. The crowd loves you. But cameras are everywhere, and a sharp-eyed producer is watching the footage with narrowed eyes.',
      image: '/quests/sr2_30.jpg',
      choices: [
        { text: 'Go for the Grand Prize', nextNode: 'ending_cheater_win', condition: { variable: 'integrity', op: '<=', value: 2 } },
        { text: 'Take the money and quit before caught', nextNode: 'ending_cautious_cheat' },
        { text: 'Confess on live TV', nextNode: 'ending_redemption', effects: [{ variable: 'integrity', op: '+', value: 10 }] },
      ],
    },
    confront_host: {
      id: 'confront_host',
      text: 'You grab the mic. "This show is rigged!" The audience gasps. The host\'s smile freezes. Security moves in — but then a producer steps forward: "He\'s right. I have evidence." The broadcast goes viral. Galactic Jackpot\'s dirty secrets exposed, live.',
      image: '/quests/sr2_04.jpg',
      choices: [
        { text: 'Finish the exposé on camera', nextNode: 'ending_whistleblower', effects: [{ variable: 'fame', op: '+', value: 10 }] },
      ],
    },
    report_fixer: {
      id: 'report_fixer',
      text: 'Station security arrests the fixer. The producer thanks you personally: "The show has been losing credibility. You just helped us clean house. Play the show for real — and we\'ll add a bonus for your honesty."',
      image: '/quests/sr2_29.jpg',
      choices: [
        { text: 'Play the show — fair and square', nextNode: 'round_one', effects: [{ variable: 'score', op: '+', value: 2 }, { variable: 'integrity', op: '+', value: 3 }] },
      ],
    },
    door_gold: {
      id: 'door_gold',
      text: 'The golden door opens to reveal... a tank containing the rarest creature in the galaxy — a bioluminescent Coral Serpent! Worth a fortune to collectors. The audience goes wild!',
      image: '/quests/sr2_13.jpg',
      choices: [
        { text: 'Accept the prize!', nextNode: 'ending_grand_prize' },
        { text: 'Trade it for credits instead', nextNode: 'ending_credits_prize' },
      ],
    },
    door_silver: {
      id: 'door_silver',
      text: 'The silver door reveals a stack of rare galactic bonds — solid, reliable wealth. Not the most exciting prize, but a guaranteed fortune. The host seems disappointed you didn\'t pick the drama door.',
      image: '/quests/sr2_21.jpg',
      choices: [
        { text: 'Take the bonds happily', nextNode: 'ending_safe_prize' },
      ],
    },
    door_mystery: {
      id: 'door_mystery',
      text: 'The mystery door opens to... another door! And behind that, a treasure map to a legendary pirate cache in the Outer Rim. Could be worth millions. Could be worthless. The ultimate gamble.',
      image: '/quests/sr2_21.jpg',
      choices: [
        { text: 'Take the map — adventure awaits!', nextNode: 'ending_adventure' },
        { text: 'Ask to switch to another door', nextNode: 'door_silver' },
      ],
    },
    ending_grand_prize: {
      id: 'ending_grand_prize',
      text: 'You walk out of Galactic Jackpot with the rarest creature in the galaxy and galaxy-wide fame. Collectors bid war breaks out. You sell the viewing rights alone for more than most pilots earn in a year. What a day!',
      image: '/quests/sr2_13.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_credits_prize: {
      id: 'ending_credits_prize',
      text: 'The Coral Serpent is traded for a clean stack of credits. No fuss, no feeding exotic pets, just pure profit. You wave to the audience, blow a kiss to the camera, and walk out rich.',
      image: '/quests/sr2_21.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_safe_prize: {
      id: 'ending_safe_prize',
      text: 'Galactic bonds — boring but brilliant. Guaranteed returns, zero risk. Not the flashiest ending, but your bank account doesn\'t care about drama. You leave quietly, sensibly wealthy.',
      image: '/quests/sr2_21.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_adventure: {
      id: 'ending_adventure',
      text: 'A pirate treasure map! The audience thinks you\'re crazy. Maybe you are. But as you plot the coordinates, your scanner confirms — the location is real, unexplored, and full of energy signatures. The real prize isn\'t what you won — it\'s what comes next.',
      image: '/quests/sr2_29.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 350 },
    },
    ending_cheater_win: {
      id: 'ending_cheater_win',
      text: 'You win the Grand Prize through cheating. But the next day, the footage leaks. Your face is on every wanted board in the sector. The prize is seized. The fixer vanished. You\'re left with nothing but infamy.',
      image: '/quests/sr2_30.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 0 },
    },
    ending_cautious_cheat: {
      id: 'ending_cautious_cheat',
      text: 'You pocket 200 credits from Round One and bail before anyone notices the earpiece. Smart move — the fixer is arrested the next day. You got away with a small score and a big lesson about risk.',
      image: '/quests/sr2_29.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 200 },
    },
    ending_redemption: {
      id: 'ending_redemption',
      text: 'You confess everything on live TV. The audience is stunned. Then they start clapping. The producer offers you a job as a show consultant — "Someone with your integrity is exactly what we need." You didn\'t win prizes, but you won something better: respect.',
      image: '/quests/sr2_04.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 300 },
    },
    ending_whistleblower: {
      id: 'ending_whistleblower',
      text: 'Galactic Jackpot is cancelled. Three producers arrested. You become a folk hero — "the ranger who broke the biggest scam in entertainment." Interview requests flood in. The prize money was nothing compared to the fame.',
      image: '/quests/sr2_04.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 450 },
    },
  },
};

// ── Quest 12: Jungle Survey ──

const QUEST_JUNGLE_SURVEY: TextQuest = {
  id: 'jungle_survey',
  title: 'Jungle Survey',
  description: 'A science team hired you to survey a jungle planet. Ancient ruins, deadly creatures, and hostile natives await.',
  image: '/quests/sr2_16.jpg',
  difficulty: 'medium',
  estimatedTime: '5-8 min',
  startNode: 'start',
  variables: { samples: 0, native_trust: 0, danger: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'The briefing map shows planet Kepler-442b — dense jungle, no colonies, uncharted. The science team needs geological samples from three sites. "Watch for megafauna," the lead researcher warns. "Last survey team lost two people." The drop zone is marked on a hand-drawn map.',
      image: '/quests/sr2_36.jpg',
      choices: [
        { text: 'Land at the main drop zone', nextNode: 'landing' },
        { text: 'Scout from orbit first', nextNode: 'orbital_scan', skillCheck: { stat: 'speed', min: 30 } },
      ],
    },
    orbital_scan: {
      id: 'orbital_scan',
      text: 'Orbital scans reveal three things: a large predator pack near Site A, smoke from what might be a settlement near Site B, and unusual mineral readings at Site C. You also spot a crashed ship — recent, not from the previous survey team.',
      image: '/quests/sr2_48.jpg',
      choices: [
        { text: 'Land near the crashed ship', nextNode: 'crashed_ship' },
        { text: 'Land at Site B — near the settlement', nextNode: 'native_village', effects: [{ variable: 'native_trust', op: '+', value: 1 }] },
        { text: 'Land at the standard drop zone', nextNode: 'landing' },
      ],
    },
    landing: {
      id: 'landing',
      text: 'Your ship settles on a ridge overlooking endless green canopy. The air is thick, humid, alive with alien insect calls. Your scanner shows the first sample site is 2 klicks north, through dense jungle. Something large moves in the canopy above.',
      image: '/quests/sr2_16.jpg',
      choices: [
        { text: 'Push through the jungle to Site A', nextNode: 'jungle_trek', effects: [{ variable: 'danger', op: '+', value: 2 }] },
        { text: 'Circle around via the river', nextNode: 'river_path' },
      ],
    },
    crashed_ship: {
      id: 'crashed_ship',
      text: 'The crashed ship is a smuggler\'s vessel. The pilot is alive — barely. He was running illegal cargo and clipped a mountain. He offers you his cargo manifest in exchange for a med-kit. The cargo? Rare bio-specimens from this very planet.',
      image: '/quests/sr2_48.jpg',
      choices: [
        { text: 'Help him and take the manifest', nextNode: 'jungle_trek', effects: [{ variable: 'samples', op: '+', value: 3 }] },
        { text: 'Leave him — not your problem', nextNode: 'jungle_trek', effects: [{ variable: 'danger', op: '+', value: 1 }] },
      ],
    },
    jungle_trek: {
      id: 'jungle_trek',
      text: 'The jungle is a cathedral of giant ferns and bioluminescent fungi. Every step crunches alien flora. Then you hear it — a low growl from the canopy. Three pairs of eyes gleam in the shadows. A pack of apex predators, each the size of a tiger, blocks your path.',
      image: '/quests/sr2_16.jpg',
      choices: [
        { text: 'Fire warning shots to scare them', nextNode: 'scare_beasts', skillCheck: { stat: 'firepower', min: 40 } },
        { text: 'Back away slowly — find another route', nextNode: 'river_path' },
        { text: 'Stand perfectly still — wait them out', nextNode: 'wait_beasts', skillCheck: { stat: 'luck', min: 45 } },
      ],
    },
    scare_beasts: {
      id: 'scare_beasts',
      text: 'Your blaster cracks the air. The predators scatter — all but the alpha, which snarls and charges! One clean shot drops it. The others flee for good. You collect a fang as a trophy and push on to the sample site.',
      image: '/quests/sr2_20.jpg',
      choices: [
        { text: 'Collect samples at Site A', nextNode: 'site_a', effects: [{ variable: 'samples', op: '+', value: 4 }] },
      ],
    },
    wait_beasts: {
      id: 'wait_beasts',
      text: 'You freeze. Minutes pass. The predators sniff, circle, and eventually lose interest. Lucky — they just ate. You slip past them silently, heart pounding, and reach the sample site unscathed.',
      image: '/quests/sr2_16.jpg',
      choices: [
        { text: 'Collect samples at Site A', nextNode: 'site_a', effects: [{ variable: 'samples', op: '+', value: 4 }] },
      ],
    },
    river_path: {
      id: 'river_path',
      text: 'The river route is longer but safer. As you follow the bank, you spot footprints — not animal, but bipedal. Intelligent life! The tracks lead to a cleared area with crude structures. A native settlement.',
      image: '/quests/sr2_44.jpg',
      choices: [
        { text: 'Approach peacefully — hands visible', nextNode: 'native_village', effects: [{ variable: 'native_trust', op: '+', value: 2 }] },
        { text: 'Avoid them — circle to Site A', nextNode: 'site_a', effects: [{ variable: 'samples', op: '+', value: 2 }] },
      ],
    },
    native_village: {
      id: 'native_village',
      text: 'A massive warrior steps forward — four arms, armored skin, weapons bristling from every angle. But he doesn\'t attack. He studies you. Behind him, a village of similar beings watches. A shaman approaches with a carved stone tablet.',
      image: '/quests/sr2_41.jpg',
      choices: [
        { text: 'Offer a gift from your supplies', nextNode: 'native_friendly', effects: [{ variable: 'native_trust', op: '+', value: 3 }] },
        { text: 'Show your scanner — demonstrate technology', nextNode: 'native_curious', effects: [{ variable: 'native_trust', op: '+', value: 1 }] },
        { text: 'Back away — too dangerous', nextNode: 'site_a', effects: [{ variable: 'samples', op: '+', value: 2 }] },
      ],
    },
    native_friendly: {
      id: 'native_friendly',
      text: 'The warrior accepts your gift — a universal med-kit. He rumbles something and the village relaxes. The shaman leads you to a cave behind the village filled with crystals the science team would kill for. Geological jackpot.',
      image: '/quests/sr2_41.jpg',
      choices: [
        { text: 'Collect crystal samples carefully', nextNode: 'ending_alliance', effects: [{ variable: 'samples', op: '+', value: 8 }] },
        { text: 'Ask to map the full cave system', nextNode: 'ending_discovery', effects: [{ variable: 'samples', op: '+', value: 6 }] },
      ],
    },
    native_curious: {
      id: 'native_curious',
      text: 'The shaman is fascinated by your scanner. He leads you to strange rock formations the natives consider sacred. Your scanner confirms — they\'re sitting on rare mineral deposits. The shaman seems to understand what you\'ve found.',
      image: '/quests/sr2_44.jpg',
      choices: [
        { text: 'Take only small samples — respect their land', nextNode: 'ending_respectful', effects: [{ variable: 'samples', op: '+', value: 5 }] },
        { text: 'Mark the deposits for the science team', nextNode: 'ending_corporate', effects: [{ variable: 'samples', op: '+', value: 7 }, { variable: 'native_trust', op: '-', value: 5 }] },
      ],
    },
    site_a: {
      id: 'site_a',
      text: 'Site A is a geological goldmine — exposed mineral veins, crystal formations, and soil samples that could fund the research program for years. But collecting takes time, and the jungle doesn\'t sleep. Distant roars remind you you\'re not alone.',
      image: '/quests/sr2_36.jpg',
      choices: [
        { text: 'Collect maximum samples — risk more time', nextNode: 'ending_thorough', effects: [{ variable: 'samples', op: '+', value: 5 }, { variable: 'danger', op: '+', value: 3 }] },
        { text: 'Grab what you can and leave fast', nextNode: 'ending_quick', effects: [{ variable: 'samples', op: '+', value: 3 }] },
      ],
    },
    ending_alliance: {
      id: 'ending_alliance',
      text: 'The natives guide you through their sacred caves. The crystal samples are extraordinary — new mineral compounds never documented. You leave as friends, with an open invitation to return. The science team is ecstatic, and you\'ve established first contact with a new species.',
      image: '/quests/sr2_41.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_discovery: {
      id: 'ending_discovery',
      text: 'The cave system extends for kilometers — an underground world of crystals and underground rivers. Your maps will rewrite the planet\'s geological profile. The natives watch with pride as you document their sacred spaces with respect.',
      image: '/quests/sr2_44.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 550 },
    },
    ending_respectful: {
      id: 'ending_respectful',
      text: 'Small samples, big results. The minerals are enough to confirm a major deposit without disturbing the native sacred sites. The science team publishes a groundbreaking paper with a note on indigenous rights. You\'re invited back as a trusted outsider.',
      image: '/quests/sr2_41.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 450 },
    },
    ending_corporate: {
      id: 'ending_corporate',
      text: 'Your detailed mineral maps spark a corporate mining rush. Within months, the jungle is being cleared. The natives are displaced. You got your paycheck, but the news feeds show the destruction of an irreplaceable ecosystem. Not your proudest moment.',
      image: '/quests/sr2_48.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 350 },
    },
    ending_thorough: {
      id: 'ending_thorough',
      text: 'You fill every container you have with samples. The jungle sends a final challenge — a predator charges as you load the last crate. You barely make it to the ship. But the haul is incredible. The science team gets more data than they dreamed of.',
      image: '/quests/sr2_20.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_quick: {
      id: 'ending_quick',
      text: 'Quick in, quick out. You grab enough samples for a solid report and get off-world before anything eats you. Professional, efficient, alive. Not every survey needs to be an epic. Sometimes just surviving the jungle is victory enough.',
      image: '/quests/sr2_48.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 250 },
    },
  },
};

// ── Quest 13: Plague Ship ──

const QUEST_PLAGUE_SHIP: TextQuest = {
  id: 'plague_ship',
  title: 'Plague Ship',
  description: 'A hospital ship sends a distress signal. A mysterious disease is killing the crew. Can you find a cure in time?',
  image: '/quests/sr2_17.jpg',
  difficulty: 'medium',
  estimatedTime: '5-7 min',
  startNode: 'start',
  variables: { infected: 0, cure_progress: 0, crew_alive: 10 },
  nodes: {
    start: {
      id: 'start',
      text: 'DISTRESS SIGNAL — Hospital Ship Mercy\'s Light. "This is Chief Medical Officer Taren. Unknown pathogen spreading through the ship. 47 crew, 23 patients — half are symptomatic. Life support failing. We need help." The ship drifts 40 minutes away.',
      image: '/quests/sr2_17.jpg',
      choices: [
        { text: 'Set course immediately — full speed', nextNode: 'boarding' },
        { text: 'Contact nearby stations for backup first', nextNode: 'call_backup' },
        { text: 'Too dangerous — report and move on', nextNode: 'ending_abandon' },
      ],
    },
    boarding: {
      id: 'boarding',
      text: 'The hospital ship is dark except for emergency lighting. The airlock opens to the smell of antiseptic and fear. Bodies on stretchers line the corridors. A nervous man in a lab coat rushes toward you — glasses askew, hands shaking.',
      image: '/quests/sr2_24.jpg',
      choices: [
        { text: '"Take me to the patients"', nextNode: 'examine_ward' },
        { text: '"Take me to the lab — we need to analyze this"', nextNode: 'lab_analysis' },
        { text: '"Where is Dr. Taren?"', nextNode: 'find_doctor' },
      ],
    },
    call_backup: {
      id: 'call_backup',
      text: 'Nearest help is 6 hours away. The ship might not have that long. But they promise a quarantine team is en route. You decide to board anyway — every minute counts when people are dying.',
      image: '/quests/sr2_17.jpg',
      choices: [
        { text: 'Board the ship', nextNode: 'boarding' },
      ],
    },
    examine_ward: {
      id: 'examine_ward',
      text: 'The ward is grim. Patients writhe with fever, their skin mottled with blue-black marks. Monitors beep warnings. The disease attacks the nervous system — patients lose motor control, then consciousness. Without treatment, death follows in 12 hours.',
      image: '/quests/sr2_06.jpg',
      choices: [
        { text: 'Take blood samples for analysis', nextNode: 'lab_analysis', effects: [{ variable: 'cure_progress', op: '+', value: 2 }] },
        { text: 'Try to stabilize the worst cases', nextNode: 'stabilize', skillCheck: { stat: 'shield', min: 35 } },
        { text: 'Find the source of the outbreak', nextNode: 'find_source' },
      ],
    },
    find_doctor: {
      id: 'find_doctor',
      text: 'Dr. Taren is an alien healer — Faeyan, with deep violet skin and eyes that seem to see through you. "The pathogen is artificial," she says quietly. "Someone engineered this. I\'ve been working on a counter-agent, but I need an organic test subject. I won\'t ask my crew."',
      image: '/quests/sr2_10.jpg',
      choices: [
        { text: 'Volunteer yourself as test subject', nextNode: 'self_test', effects: [{ variable: 'infected', op: '+', value: 1 }, { variable: 'cure_progress', op: '+', value: 5 }] },
        { text: 'Help her refine the counter-agent first', nextNode: 'lab_analysis', effects: [{ variable: 'cure_progress', op: '+', value: 3 }] },
        { text: 'Search the ship for the saboteur', nextNode: 'find_source' },
      ],
    },
    lab_analysis: {
      id: 'lab_analysis',
      text: 'The nervous researcher — Dr. Kim — works frantically at the microscope. "The pathogen has markers consistent with military bioweapons. Someone brought this aboard deliberately." He shows you the molecular structure. With the right synthesis, a cure is possible — but it needs a rare catalyst.',
      image: '/quests/sr2_24.jpg',
      choices: [
        { text: 'Search the ship\'s pharmacy for the catalyst', nextNode: 'pharmacy', effects: [{ variable: 'cure_progress', op: '+', value: 2 }] },
        { text: 'Ask the elder crew member — she might know old remedies', nextNode: 'elder_wisdom' },
        { text: 'Synthesize a substitute compound', nextNode: 'synthesize', skillCheck: { stat: 'luck', min: 50 } },
      ],
    },
    stabilize: {
      id: 'stabilize',
      text: 'Your emergency medical training kicks in. You stabilize three critical patients with adrenaline cocktails and cooling blankets. They\'ll live a few more hours. Dr. Taren watches approvingly. "You have good hands, ranger. Now help me find a cure."',
      image: '/quests/sr2_06.jpg',
      choices: [
        { text: 'Go to the lab', nextNode: 'lab_analysis', effects: [{ variable: 'cure_progress', op: '+', value: 2 }] },
        { text: 'Find Dr. Taren\'s research', nextNode: 'find_doctor', effects: [{ variable: 'crew_alive', op: '+', value: 2 }] },
      ],
    },
    find_source: {
      id: 'find_source',
      text: 'You trace the outbreak to a cargo container that wasn\'t on the manifest. Inside: a shattered vial with trace residue. Bioweapon. Sabotage. But who? Security logs show only three people accessed this cargo bay in the last 48 hours.',
      image: '/quests/sr2_06.jpg',
      choices: [
        { text: 'Interrogate the suspects', nextNode: 'ending_detective', effects: [{ variable: 'cure_progress', op: '+', value: 2 }] },
        { text: 'Focus on the cure — justice can wait', nextNode: 'lab_analysis', effects: [{ variable: 'cure_progress', op: '+', value: 3 }] },
      ],
    },
    pharmacy: {
      id: 'pharmacy',
      text: 'The pharmacy has been raided — someone was here before you. Most shelves are empty. But in a locked cabinet, you find three vials of the catalyst compound. Just enough for a batch of cure — if the synthesis works.',
      image: '/quests/sr2_06.jpg',
      choices: [
        { text: 'Rush the vials to the lab', nextNode: 'ending_cure', effects: [{ variable: 'cure_progress', op: '+', value: 5 }] },
      ],
    },
    elder_wisdom: {
      id: 'elder_wisdom',
      text: 'Old Marta, the ship\'s longest-serving crew member, sits hunched with a small medical kit. "I\'ve seen plagues before, young one. Not this exact one, but similar. There\'s a plant in the hydroponics bay — Stellaria root. Might slow the pathogen enough to buy time."',
      image: '/quests/sr2_38.jpg',
      choices: [
        { text: 'Get the Stellaria root — could be the catalyst!', nextNode: 'ending_traditional', effects: [{ variable: 'cure_progress', op: '+', value: 4 }] },
        { text: 'Combine her knowledge with the lab data', nextNode: 'ending_cure', effects: [{ variable: 'cure_progress', op: '+', value: 6 }] },
      ],
    },
    self_test: {
      id: 'self_test',
      text: 'Dr. Taren injects you with the counter-agent. For sixty terrible seconds, your blood burns. Your vision blurs. Then — clarity. The counter-agent works. You feel it fighting the pathogen. Dr. Taren runs the numbers: "We can scale this. You just saved everyone."',
      image: '/quests/sr2_10.jpg',
      choices: [
        { text: 'Help distribute the cure', nextNode: 'ending_hero' },
      ],
    },
    synthesize: {
      id: 'synthesize',
      text: 'You improvise a substitute catalyst from ship\'s supplies. It\'s crude, untested, and might not work. You run the synthesis anyway. The compound stabilizes — imperfect but functional. A 70% cure rate, enough to save most of the crew.',
      image: '/quests/sr2_24.jpg',
      choices: [
        { text: 'Administer to all patients', nextNode: 'ending_partial_cure' },
      ],
    },
    ending_abandon: {
      id: 'ending_abandon',
      text: 'You report the distress signal and move on. Two days later, the quarantine team finds the Mercy\'s Light. Nine survivors out of seventy. The disease is contained, but you can\'t shake the thought: would more have survived if you\'d gone?',
      image: '/quests/sr2_17.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 50 },
    },
    ending_cure: {
      id: 'ending_cure',
      text: 'The cure works. Within hours, patients are stabilizing. Within a day, everyone is recovering. Dr. Taren clasps your hand — "You saved sixty-eight lives today, ranger." The Galactic Medical Authority awards you a commendation and a substantial reward.',
      image: '/quests/sr2_10.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_hero: {
      id: 'ending_hero',
      text: 'By volunteering your own body, you gave Dr. Taren the data she needed. The cure is synthesized and distributed. Every patient recovers. You spend two days in the infirmary yourself, but you walk out knowing you saved an entire ship. Hero status: earned.',
      image: '/quests/sr2_10.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 800 },
    },
    ending_traditional: {
      id: 'ending_traditional',
      text: 'Old Marta\'s Stellaria root is the missing piece. Combined with the lab compound, it creates a powerful antiviral. The cure saves everyone — and the medical paper published afterward credits both ancient botanical knowledge and modern science. Marta finally gets the recognition she deserves.',
      image: '/quests/sr2_38.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_partial_cure: {
      id: 'ending_partial_cure',
      text: 'Your improvised cure saves 48 out of 70 people. Not perfect — some were too far gone. But without your intervention, all would have died. Dr. Kim refines your formula into a proper treatment, crediting your quick thinking. Imperfect heroism is still heroism.',
      image: '/quests/sr2_24.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 400 },
    },
    ending_detective: {
      id: 'ending_detective',
      text: 'You identify the saboteur — a crew member paid by a rival pharmaceutical company to test a bioweapon on live subjects. The evidence is transmitted to authorities. The quarantine team arrives with a cure already in development. Your detective work prevented a cover-up.',
      image: '/quests/sr2_06.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
  },
};

// ── Quest 14: Fortress Heist ──

const QUEST_FORTRESS_HEIST: TextQuest = {
  id: 'fortress_heist',
  title: 'Fortress Heist',
  description: 'A corporate whistleblower needs data stolen from the most secure building in the sector. Stealth, force, or wit — choose wisely.',
  image: '/quests/sr2_26.jpg',
  difficulty: 'hard',
  estimatedTime: '6-8 min',
  startNode: 'start',
  variables: { alarm: 0, data: 0, stealth: 5 },
  nodes: {
    start: {
      id: 'start',
      text: 'The Obsidian Spire rises from a mountain like a black fang — OmniCorp\'s central data fortress. Your contact, a former employee, briefs you: "Floor 22, Server Room C. The evidence of their illegal experiments is there. Security is... extreme." She hands you a keycard. "This gets you to the lobby. The rest is on you."',
      image: '/quests/sr2_26.jpg',
      choices: [
        { text: 'Front door — use the keycard', nextNode: 'lobby' },
        { text: 'Service entrance — maintenance disguise', nextNode: 'service_entry', effects: [{ variable: 'stealth', op: '+', value: 3 }] },
        { text: 'Roof approach — grapple from above', nextNode: 'roof_entry', skillCheck: { stat: 'speed', min: 50 } },
      ],
    },
    lobby: {
      id: 'lobby',
      text: 'The lobby is sleek chrome and surveillance cameras. Your keycard beeps green at the turnstile. An elevator bank ahead — but a guard eyes you. "Haven\'t seen you before. Which floor?"',
      image: '/quests/sr2_31.jpg',
      choices: [
        { text: '"Floor 22. Systems audit."', nextNode: 'elevator_22', skillCheck: { stat: 'luck', min: 40 } },
        { text: '"Floor 5. Just a meeting."', nextNode: 'floor_5_detour', effects: [{ variable: 'stealth', op: '+', value: 1 }] },
        { text: 'Distract him — spill your coffee', nextNode: 'distract_guard', effects: [{ variable: 'stealth', op: '+', value: 2 }] },
      ],
    },
    service_entry: {
      id: 'service_entry',
      text: 'You slip in through the loading dock in a maintenance jumpsuit. Service corridors are dimly lit and unmonitored — mostly. A cleaning robot scans you briefly but accepts the uniform. The service elevator goes to Floor 20. Close enough.',
      image: '/quests/sr2_18.jpg',
      choices: [
        { text: 'Take the service elevator to Floor 20', nextNode: 'floor_20' },
        { text: 'Take the stairs — slower but no cameras', nextNode: 'stairwell', effects: [{ variable: 'stealth', op: '+', value: 2 }] },
      ],
    },
    roof_entry: {
      id: 'roof_entry',
      text: 'You rappel down from the roof. Wind howls at this altitude. The ventilation shaft on Floor 23 is just wide enough. You crawl through ductwork, hearing muffled conversations below. One floor down — Floor 22.',
      image: '/quests/sr2_26.jpg',
      choices: [
        { text: 'Drop into Floor 22 corridor', nextNode: 'corridor_22', effects: [{ variable: 'stealth', op: '+', value: 3 }] },
      ],
    },
    distract_guard: {
      id: 'distract_guard',
      text: 'Your "clumsy" coffee spill sends the guard scrambling for napkins. You slip past, badge the elevator, and press 22 before he looks up. The doors close on his confused face. Going up.',
      image: '/quests/sr2_31.jpg',
      choices: [
        { text: 'Ride to Floor 22', nextNode: 'corridor_22' },
      ],
    },
    floor_5_detour: {
      id: 'floor_5_detour',
      text: 'Floor 5 is open office — boring but useful. You find an unattended terminal and pull up the building schematics. Floor 22 has biometric locks, laser grids, and patrol robots. But there\'s a blind spot — the maintenance shaft between rooms C and D.',
      image: '/quests/sr2_31.jpg',
      choices: [
        { text: 'Head to Floor 22 via maintenance shaft', nextNode: 'corridor_22', effects: [{ variable: 'stealth', op: '+', value: 3 }] },
      ],
    },
    elevator_22: {
      id: 'elevator_22',
      text: 'The guard nods and waves you through. The elevator rises smoothly. Floor 22 — the doors open to a sterile white corridor. Signs read "AUTHORIZED PERSONNEL ONLY." A camera tracks left-right-left. You have a 4-second window between sweeps.',
      image: '/quests/sr2_18.jpg',
      choices: [
        { text: 'Time the cameras and move', nextNode: 'corridor_22', effects: [{ variable: 'stealth', op: '+', value: 1 }] },
      ],
    },
    floor_20: {
      id: 'floor_20',
      text: 'Floor 20 is storage. Boxes labeled with project codes. You take the stairs up two flights to Floor 22. The stairwell door has a simple lock — your multi-tool handles it.',
      image: '/quests/sr2_18.jpg',
      choices: [
        { text: 'Enter Floor 22', nextNode: 'corridor_22' },
      ],
    },
    stairwell: {
      id: 'stairwell',
      text: 'Twenty-two flights of stairs in a maintenance jumpsuit. Your legs burn but there are zero cameras, zero guards. You reach Floor 22\'s fire exit. Locked from the outside — but not from the stairwell side. You push through silently.',
      image: '/quests/sr2_18.jpg',
      choices: [
        { text: 'Enter Floor 22', nextNode: 'corridor_22' },
      ],
    },
    corridor_22: {
      id: 'corridor_22',
      text: 'Floor 22. Server Room C is at the end of the corridor, behind a reinforced door. Your contact\'s keycard might work — or it might trigger an alarm. You also spot an open ventilation grate and a janitor\'s closet.',
      image: '/quests/sr2_18.jpg',
      choices: [
        { text: 'Use the keycard on the door', nextNode: 'server_room', condition: { variable: 'stealth', op: '>=', value: 5 } },
        { text: 'Crawl through the vent', nextNode: 'server_room', effects: [{ variable: 'stealth', op: '+', value: 2 }] },
        { text: 'Use the keycard on the door', nextNode: 'alarm_triggered', condition: { variable: 'stealth', op: '<=', value: 4 } },
      ],
    },
    server_room: {
      id: 'server_room',
      text: 'Server Room C hums with racks of data cores. Blinking lights, cold air, the quiet whisper of cooling fans. You find the terminal and plug in your extraction drive. Data flows — project files, experiment logs, financial records. Evidence of illegal AI experimentation on sentient beings.',
      image: '/quests/sr2_07.jpg',
      choices: [
        { text: 'Take only the evidence files', nextNode: 'ending_clean_heist', effects: [{ variable: 'data', op: '+', value: 5 }] },
        { text: 'Copy everything — more leverage', nextNode: 'ending_full_download', effects: [{ variable: 'data', op: '+', value: 10 }, { variable: 'alarm', op: '+', value: 3 }] },
        { text: 'Plant a virus while you\'re at it', nextNode: 'ending_sabotage', effects: [{ variable: 'alarm', op: '+', value: 5 }] },
      ],
    },
    alarm_triggered: {
      id: 'alarm_triggered',
      text: 'The keycard beeps RED. Alarms blare. Lockdown initiated. You have maybe 90 seconds before security floods this floor. The server room door is still locked — but a fire axe on the wall could handle that.',
      image: '/quests/sr2_28.jpg',
      choices: [
        { text: 'Smash the door — grab what you can', nextNode: 'server_room', effects: [{ variable: 'alarm', op: '+', value: 5 }] },
        { text: 'Abort — escape now', nextNode: 'ending_abort' },
      ],
    },
    ending_clean_heist: {
      id: 'ending_clean_heist',
      text: 'Surgical extraction. You take only what\'s needed — evidence of illegal experiments. You exit the building the way you came in, calm and professional. The data is delivered to your contact, who publishes it across every news network. OmniCorp\'s stock crashes 40% overnight. Clean, quiet, devastating.',
      image: '/quests/sr2_07.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_full_download: {
      id: 'ending_full_download',
      text: 'You copy everything — 2.7 terabytes of corporate secrets. The extra download time triggers a silent alarm. Security is waiting at the lobby. But you anticipated this — you exit through the roof. The data is a goldmine: evidence, trade secrets, employee records. Your contact gets the evidence. You keep the rest... for insurance.',
      image: '/quests/sr2_26.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
    ending_sabotage: {
      id: 'ending_sabotage',
      text: 'Your virus tears through OmniCorp\'s network like wildfire. Servers crash. Data corrupts. Years of research — some illegal, some legitimate — destroyed in minutes. You escape in the chaos of a building-wide system failure. Heavy-handed, but effective. OmniCorp won\'t recover for years.',
      image: '/quests/sr2_28.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_abort: {
      id: 'ending_abort',
      text: 'You run. Guards chase. You make it out through a service exit, uniform singed by a near-miss stun bolt. No data, no evidence, and your cover is blown. Your contact is disappointed. "There\'ll be another chance," she says. Maybe. But not today.',
      image: '/quests/sr2_28.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
  },
};

// ── Quest 15: Mercenary Contract ──

const QUEST_MERC_CONTRACT: TextQuest = {
  id: 'merc_contract',
  title: 'Mercenary Contract',
  description: 'A mercenary commander offers a lucrative combat contract. The pay is good, but the cause might not be.',
  image: '/quests/sr2_47.jpg',
  difficulty: 'hard',
  estimatedTime: '6-8 min',
  startNode: 'start',
  variables: { morale: 5, kills: 0, honor: 5 },
  nodes: {
    start: {
      id: 'start',
      text: 'A grizzled commander sits across from you in a dim cantina. Scars map his face like a road atlas of violence. "Name\'s Krovak. I need pilots for a three-day operation. Colony defense on Meridian-IV. Dominators are pushing hard. Pay is 2,000 credits. Interested?"',
      image: '/quests/sr2_47.jpg',
      choices: [
        { text: '"I\'m in. When do we leave?"', nextNode: 'briefing' },
        { text: '"What\'s the real story? Dominators don\'t hit random colonies."', nextNode: 'real_story', effects: [{ variable: 'honor', op: '+', value: 2 }] },
        { text: '"Not my fight. Good luck."', nextNode: 'ending_decline' },
      ],
    },
    briefing: {
      id: 'briefing',
      text: 'The briefing shows Meridian-IV — a frontier colony of 3,000 civilians. Dominator forces are raiding it for resources. Your wing will provide air cover while ground forces evacuate civilians. Krovak points at the map: "Three days. That\'s all we need. After that, the Navy takes over."',
      image: '/quests/sr2_46.jpg',
      choices: [
        { text: 'Accept the mission as described', nextNode: 'day_one' },
        { text: 'Ask for more pay — this is dangerous', nextNode: 'negotiate_pay', effects: [{ variable: 'honor', op: '-', value: 1 }] },
      ],
    },
    real_story: {
      id: 'real_story',
      text: 'Krovak sighs. "Fine. The colony sits on a rare mineral deposit. Both the Dominators AND a mega-corp want it. The colonists are caught in the middle. I was hired by the colonial governor, not the corp. This is a civilian defense job. Clean." He meets your eyes. "I don\'t take dirty contracts."',
      image: '/quests/sr2_47.jpg',
      choices: [
        { text: 'Respect that. I\'m in.', nextNode: 'briefing', effects: [{ variable: 'honor', op: '+', value: 2 }] },
        { text: 'Still not convinced — decline', nextNode: 'ending_decline' },
      ],
    },
    negotiate_pay: {
      id: 'negotiate_pay',
      text: 'Krovak frowns. "Colonists are pooling their savings for this. But fine — 2,500. Not a credit more." He extends his hand.',
      image: '/quests/sr2_47.jpg',
      choices: [
        { text: 'Shake on it', nextNode: 'day_one' },
      ],
    },
    day_one: {
      id: 'day_one',
      text: 'Day One. You drop into the atmosphere over Meridian-IV. The colony is a cluster of domes and solar farms. Dominator scouts appear on radar — three light fighters probing defenses. Your wing leader calls: "Weapons free. Show them we\'re here."',
      image: '/quests/sr2_46.jpg',
      choices: [
        { text: 'Engage aggressively — send a message', nextNode: 'fight_scouts', skillCheck: { stat: 'firepower', min: 40 } },
        { text: 'Defensive posture — protect the colony', nextNode: 'defend_colony', skillCheck: { stat: 'shield', min: 40 } },
      ],
    },
    fight_scouts: {
      id: 'fight_scouts',
      text: 'You tear into the scouts with everything you\'ve got. Two explode. The third limps away trailing smoke. Your squadron cheers. But Krovak is on the comm: "Don\'t get cocky. That was recon. The real assault comes tomorrow."',
      image: '/quests/sr2_46.jpg',
      choices: [
        { text: 'Rest and prepare for Day Two', nextNode: 'day_two', effects: [{ variable: 'kills', op: '+', value: 2 }, { variable: 'morale', op: '+', value: 2 }] },
      ],
    },
    defend_colony: {
      id: 'defend_colony',
      text: 'You form a shield wall over the colony. The scouts probe and retreat without engaging. No kills, but no damage to the colony either. Krovak nods: "Smart. Save your ammo. Tomorrow they\'ll come in force."',
      image: '/quests/sr2_05.jpg',
      choices: [
        { text: 'Rest and prepare for Day Two', nextNode: 'day_two', effects: [{ variable: 'morale', op: '+', value: 1 }] },
      ],
    },
    day_two: {
      id: 'day_two',
      text: 'Day Two. Dawn breaks over the colony. Radar fills with contacts — a full Dominator assault wing. Twelve fighters and a bombing ship. Ground AA opens fire but it\'s not enough. Krovak: "This is it! Everything we\'ve got!" Then your wingman takes a hit and spirals down.',
      image: '/quests/sr2_46.jpg',
      choices: [
        { text: 'Focus on the bomber — stop the devastation', nextNode: 'attack_bomber', skillCheck: { stat: 'firepower', min: 50 } },
        { text: 'Save your wingman first', nextNode: 'save_wingman', effects: [{ variable: 'honor', op: '+', value: 3 }] },
        { text: 'Break formation — fight your own battle', nextNode: 'solo_fight', skillCheck: { stat: 'speed', min: 55 } },
      ],
    },
    attack_bomber: {
      id: 'attack_bomber',
      text: 'You dive through a wall of plasma fire, locking onto the bomber. Your shots hammer its shields. One burst, two, three — the bomber\'s engine detonates. The shockwave rattles your ship. Without their bomber, the Dominators break off the attack.',
      image: '/quests/sr2_39.jpg',
      choices: [
        { text: 'Regroup for Day Three', nextNode: 'day_three', effects: [{ variable: 'kills', op: '+', value: 3 }, { variable: 'morale', op: '+', value: 3 }] },
      ],
    },
    save_wingman: {
      id: 'save_wingman',
      text: 'You break formation to cover your falling wingman. Drawing fire, you take hits — shields buckle — but he ejects safely. The colony takes some damage from the bomber, but your wingman owes you his life. He grabs your arm later, unable to speak. No words needed.',
      image: '/quests/sr2_43.jpg',
      choices: [
        { text: 'Regroup for Day Three', nextNode: 'day_three', effects: [{ variable: 'honor', op: '+', value: 5 }, { variable: 'morale', op: '+', value: 2 }] },
      ],
    },
    solo_fight: {
      id: 'solo_fight',
      text: 'You go lone wolf — weaving through the dogfight with deadly precision. Four Dominator fighters fall to your guns. You\'re untouchable. But the colony takes hits while you were showboating. Krovak is furious: "We\'re here to DEFEND, not show off!"',
      image: '/quests/sr2_46.jpg',
      choices: [
        { text: 'Accept the criticism — refocus', nextNode: 'day_three', effects: [{ variable: 'kills', op: '+', value: 4 }, { variable: 'honor', op: '-', value: 2 }] },
      ],
    },
    day_three: {
      id: 'day_three',
      text: 'Day Three. Final day. The Navy is 6 hours out. The Dominators know it — this is their last chance. They throw everything: fighters, bombers, ground troops. The colony\'s perimeter is breached. Civilians are running for the bunkers. Krovak: "Hold the line. Just hold."',
      image: '/quests/sr2_05.jpg',
      choices: [
        { text: 'Hold the line — fight to the last', nextNode: 'ending_hold_line', effects: [{ variable: 'kills', op: '+', value: 3 }] },
        { text: 'Lead a counterattack — push them back', nextNode: 'ending_counterattack', skillCheck: { stat: 'firepower', min: 55 } },
        { text: 'Focus on civilian evacuation', nextNode: 'ending_evacuation', effects: [{ variable: 'honor', op: '+', value: 5 }] },
      ],
    },
    ending_decline: {
      id: 'ending_decline',
      text: 'You walk away from the cantina. Krovak finds another pilot. Weeks later, you hear that Meridian-IV was saved — barely. Three mercenaries died. You wonder if you would have made the difference. The credits you didn\'t earn feel like nothing compared to the question you\'ll never answer.',
      image: '/quests/sr2_47.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 50 },
    },
    ending_hold_line: {
      id: 'ending_hold_line',
      text: 'Six hours of hell. Your ship is barely flying by the end — shields gone, one engine out, canopy cracked. But you held. The Navy arrives to find the Dominators in full retreat and a colony still standing. Krovak pays you double: "You earned it ten times over."',
      image: '/quests/sr2_05.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_counterattack: {
      id: 'ending_counterattack',
      text: 'You lead the remaining pilots in a devastating counterattack. The Dominator command ship wasn\'t expecting aggression — your missile salvo cripples it. Without coordination, the Dominator forces scatter. The colony is saved. Krovak actually smiles: "I\'ve never seen flying like that."',
      image: '/quests/sr2_46.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 900 },
    },
    ending_evacuation: {
      id: 'ending_evacuation',
      text: 'You ignore the dogfight and fly cover for the evacuation transports. Every civilian shuttle that lifts off under your protection is a life saved. By the time the Navy arrives, 2,800 of 3,000 colonists are safe. The colony can be rebuilt. People can\'t.',
      image: '/quests/sr2_43.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 600 },
    },
  },
};

// ── Quest 16: Alien Embassy ──

const QUEST_ALIEN_EMBASSY: TextQuest = {
  id: 'alien_embassy',
  title: 'Alien Embassy',
  description: 'A diplomatic mission to an alien world. Cultural misunderstandings could spark an incident — or forge an alliance.',
  image: '/quests/sr2_49.jpg',
  difficulty: 'easy',
  estimatedTime: '4-6 min',
  startNode: 'start',
  variables: { reputation: 5, cultural_points: 0, gifts: 0 },
  nodes: {
    start: {
      id: 'start',
      text: 'The Gaalian High Council has invited a human representative to their homeworld for the first time. Somehow, you got the assignment. Your briefing is slim: "Be respectful. Don\'t touch their food. Bow when they bow." The Gaalian embassy awaits.',
      image: '/quests/sr2_49.jpg',
      choices: [
        { text: 'Enter the embassy formally', nextNode: 'council_hall' },
        { text: 'Ask the taxi driver about local customs', nextNode: 'taxi_wisdom' },
      ],
    },
    taxi_wisdom: {
      id: 'taxi_wisdom',
      text: 'The taxi driver — a chatty alien with four eyes — gives you the real briefing: "The Council respects strength and humor. Don\'t be stiff. Also, if they offer you Zyrka juice, drink it even though it smells terrible. Refusing is a major insult."',
      image: '/quests/sr2_25.jpg',
      choices: [
        { text: 'Thanks — head to the embassy', nextNode: 'council_hall', effects: [{ variable: 'cultural_points', op: '+', value: 3 }] },
      ],
    },
    council_hall: {
      id: 'council_hall',
      text: 'The Council Hall is vast. Five Gaalian elders sit around a stone table. Their leader — an elderly alien with deep-set eyes — speaks: "Human. We have watched your species for some time. We are... curious. Will you share a meal with us? It is our custom for first meetings."',
      image: '/quests/sr2_49.jpg',
      choices: [
        { text: 'Accept the meal graciously', nextNode: 'shared_meal', effects: [{ variable: 'reputation', op: '+', value: 2 }] },
        { text: 'Offer a gift first — it\'s human custom', nextNode: 'gift_exchange', effects: [{ variable: 'gifts', op: '+', value: 1 }] },
        { text: 'Ask to see their city first — show interest', nextNode: 'city_tour' },
      ],
    },
    shared_meal: {
      id: 'shared_meal',
      text: 'The meal is... alien. Bowls of iridescent paste, crunchy beetles, and a cup of something that smells like wet socks — the infamous Zyrka juice. The elders watch you carefully.',
      image: '/quests/sr2_42.jpg',
      choices: [
        { text: 'Drink the Zyrka juice and eat everything', nextNode: 'meal_success', effects: [{ variable: 'reputation', op: '+', value: 3 }, { variable: 'cultural_points', op: '+', value: 2 }] },
        { text: 'Politely try a small portion', nextNode: 'meal_polite', effects: [{ variable: 'reputation', op: '+', value: 1 }] },
        { text: 'Can\'t do it — make an excuse', nextNode: 'meal_refuse', effects: [{ variable: 'reputation', op: '-', value: 3 }] },
      ],
    },
    meal_success: {
      id: 'meal_success',
      text: 'The Zyrka juice tastes like burning licorice. You manage not to gag. The elders beam with approval. "This one has courage!" they declare. The mood shifts from formal to warm. They begin sharing stories, laughing, treating you like family.',
      image: '/quests/sr2_42.jpg',
      choices: [
        { text: 'Share a human story in return', nextNode: 'cultural_exchange', effects: [{ variable: 'cultural_points', op: '+', value: 3 }] },
        { text: 'Ask about their technology', nextNode: 'tech_tour' },
      ],
    },
    meal_polite: {
      id: 'meal_polite',
      text: 'You nibble politely. The elders nod — acceptable, if not impressive. The conversation moves to business. "We appreciate your effort," the leader says. "Now, let us discuss trade terms."',
      image: '/quests/sr2_42.jpg',
      choices: [
        { text: 'Discuss trade — keep it formal', nextNode: 'ending_trade_deal' },
        { text: 'Ask for a city tour to understand them better', nextNode: 'city_tour' },
      ],
    },
    meal_refuse: {
      id: 'meal_refuse',
      text: 'The elders exchange glances. The mood chills. "We see," the leader says quietly. A cultural slight — refusing a shared meal. Your guards are escorted to the door by stern-looking Gaalian soldiers.',
      image: '/quests/sr2_12.jpg',
      choices: [
        { text: 'Apologize immediately', nextNode: 'apology', effects: [{ variable: 'reputation', op: '+', value: 1 }] },
        { text: 'Accept the dismissal gracefully', nextNode: 'ending_failed_diplomacy' },
      ],
    },
    gift_exchange: {
      id: 'gift_exchange',
      text: 'You present a crystalline star map — a representation of the sector from the human perspective. The elders study it with fascination. "Beautiful," the leader murmurs. "Your species sees the stars differently than we do." The gift opens hearts and minds.',
      image: '/quests/sr2_40.jpg',
      choices: [
        { text: 'Join them for the meal', nextNode: 'shared_meal', effects: [{ variable: 'reputation', op: '+', value: 2 }] },
      ],
    },
    city_tour: {
      id: 'city_tour',
      text: 'A Gaalian scientist — Dr. Zeen — volunteers as guide. She shows you the botanical gardens, the quantum computing center, and the public gym where massive Gaalians lift weights that would crush a human. "We value body and mind equally," she explains.',
      image: '/quests/sr2_45.jpg',
      choices: [
        { text: 'Try lifting a Gaalian weight', nextNode: 'gym_attempt', skillCheck: { stat: 'shield', min: 30 } },
        { text: 'Visit Dr. Zeen\'s laboratory', nextNode: 'tech_tour', effects: [{ variable: 'cultural_points', op: '+', value: 2 }] },
        { text: 'Ask about the small creatures in their homes', nextNode: 'alien_pets' },
      ],
    },
    gym_attempt: {
      id: 'gym_attempt',
      text: 'You grab the smallest weight — it\'s 80kg. You manage one shaky rep. The Gaalians roar with laughter and approval. "Small but strong!" one bellows, clapping your back hard enough to wind you. You\'ve earned their respect through effort, not success.',
      image: '/quests/sr2_45.jpg',
      choices: [
        { text: 'Laugh along and continue the tour', nextNode: 'tech_tour', effects: [{ variable: 'reputation', op: '+', value: 3 }] },
      ],
    },
    tech_tour: {
      id: 'tech_tour',
      text: 'Dr. Zeen\'s laboratory is remarkable — organic computing, bio-engineered materials, technology that grows rather than being built. She offers a data crystal: "A gift of knowledge. Our recent research in gravitational harmonics. Perhaps it will help your people."',
      image: '/quests/sr2_40.jpg',
      choices: [
        { text: 'Accept graciously and offer human research in return', nextNode: 'ending_alliance', effects: [{ variable: 'cultural_points', op: '+', value: 3 }] },
        { text: 'Accept and ask about military applications', nextNode: 'ending_suspicious', effects: [{ variable: 'reputation', op: '-', value: 2 }] },
      ],
    },
    alien_pets: {
      id: 'alien_pets',
      text: 'In a Gaalian home, you find adorable creatures curled up in shoe lockers — Purrik, their domestic companions. They\'re soft, warm, and make a sound like a contented engine. The homeowner offers you one: "They bond quickly with caring owners."',
      image: '/quests/sr2_32.jpg',
      choices: [
        { text: 'Accept the Purrik — an interspecies friendship!', nextNode: 'ending_friendship', effects: [{ variable: 'cultural_points', op: '+', value: 3 }] },
        { text: 'Politely decline — focus on diplomacy', nextNode: 'ending_trade_deal' },
      ],
    },
    apology: {
      id: 'apology',
      text: 'You bow deeply. "I apologize. In my nervousness, I forgot my manners. Allow me to try again." The leader studies you... then smiles. "Honesty and humility. Perhaps there is hope for this meeting after all." The mood thaws slightly.',
      image: '/quests/sr2_49.jpg',
      choices: [
        { text: 'Eat the meal — all of it this time', nextNode: 'meal_success', effects: [{ variable: 'reputation', op: '+', value: 1 }] },
      ],
    },
    cultural_exchange: {
      id: 'cultural_exchange',
      text: 'You tell them about Earth — its oceans, its music, its wars and peace. The elders listen with the quiet intensity of beings who have lived centuries. When you finish, the leader speaks: "We are not so different. Let us build a bridge between our worlds."',
      image: '/quests/sr2_49.jpg',
      choices: [
        { text: 'Propose a formal alliance', nextNode: 'ending_alliance' },
        { text: 'Suggest cultural exchange programs first', nextNode: 'ending_friendship' },
      ],
    },
    ending_alliance: {
      id: 'ending_alliance',
      text: 'The Gaalian-Human Alliance is signed in the Council Hall. Trade, knowledge sharing, mutual defense. You return home not just as a diplomat but as the person who expanded humanity\'s place in the galaxy. Dr. Zeen sends you a message: "Come back anytime, friend."',
      image: '/quests/sr2_49.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 700 },
    },
    ending_friendship: {
      id: 'ending_friendship',
      text: 'No formal alliance yet — but something more valuable: genuine friendship. The Gaalians invite human students, and Gaalian scholars visit Earth. And you walk away with a Purrik companion who sleeps in your shoe locker and purrs when you come home. Some diplomatic victories are personal.',
      image: '/quests/sr2_32.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 500 },
    },
    ending_trade_deal: {
      id: 'ending_trade_deal',
      text: 'A formal trade agreement — nothing flashy, but profitable. Gaalian bio-materials for human quantum processors. Both sides benefit. The elders see you as competent if not warm. A good start for interspecies relations.',
      image: '/quests/sr2_49.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 350 },
    },
    ending_suspicious: {
      id: 'ending_suspicious',
      text: 'Dr. Zeen\'s expression hardens. "Military applications? That\'s not why I shared this." The Council hears about your question. The meeting ends politely but coldly. No alliance, no trade deal, and a note in the Gaalian files: "Humans — approach with caution."',
      image: '/quests/sr2_35.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 100 },
    },
    ending_failed_diplomacy: {
      id: 'ending_failed_diplomacy',
      text: 'You leave the Gaalian homeworld empty-handed. The Council marks humans as "culturally insensitive." It\'ll take years to repair the damage. Your superiors are not pleased. Sometimes the smallest gestures carry the heaviest consequences.',
      image: '/quests/sr2_12.jpg',
      choices: [],
      isEnding: true,
      reward: { coins: 0 },
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
  QUEST_WORMHOLE_GAMBIT,
  QUEST_LIVING_CITY,
  QUEST_GALACTIC_JACKPOT,
  QUEST_JUNGLE_SURVEY,
  QUEST_PLAGUE_SHIP,
  QUEST_FORTRESS_HEIST,
  QUEST_MERC_CONTRACT,
  QUEST_ALIEN_EMBASSY,
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
