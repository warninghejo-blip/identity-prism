import type { WalletTraits } from '@/hooks/useWalletData';

export const FUNNY_FACTS = [
  // General / Random
  "Your wallet has seen more drama than a reality TV show.",
  "Hodling since the dawn of time (or at least since last week).",
  "If transactions were miles, you'd be on Mars by now.",
  "Proof that diamond hands are made, not born.",
  "Your portfolio is a rollercoaster that only goes... somewhere.",
  "Waiting for the moon? We brought the moon to you.",
  "Stardust in, SOL out. The circle of life.",
  "You're not a degens, you're an 'aggressive investor'.",
  "This wallet sparks joy. Mostly.",
  "Rumor has it, this wallet is haunted by lost gas fees.",
  "A true connoisseur of digital collectibles.",
  "More transactions than a caffeine-fueled day trader.",
  "Your private keys are safer than the Colonel's secret recipe.",
  "Solana speed, snail pace decision making. (Just kidding).",
  "You've survived more dips than a tortilla chip.",

  // Preorder / No Seeker (The specific request)
  "Preordered the future, but the Seeker is still seeking you.",
  "You have the vision (Preorder), but where is the sight (Seeker)?",
  "Visionary status: Confirmed. Seeker status: 404 Not Found.",
  "All dressed up with a Preorder, but no Seeker to go.",
  "Waiting for that Seeker like waiting for rain in the desert.",
  "You bought the ticket (Preorder), now find the ride (Seeker).",
  "Preorder secured. Seeker... distinct possibility of maybe.",
  "Legend says your Seeker is still minting in another dimension.",
  "Got the Preorder badge, but the Seeker is playing hard to get.",
  "Visionary enough to preorder, patient enough to wait for the Seeker.",

  // Whale
  "You have enough SOL to influence the tides.",
  "Warning: Heavy wallet. Lift with your legs.",
  "Leave some liquidity for the rest of us!",
  "Your balance phone number length? Impressive.",
  "Whale alert! Harpoons not included.",

  // Tiny Balance
  "Running on hopes, dreams, and dust.",
  "Gas money? barely.",
  "It's not about size, it's about... potential?",
  "Keeping it lean. Very, very lean.",
  "Every satoshi counts, right?",

  // Old Wallet
  "You remember when SOL was single digits.",
  "This wallet belongs in a museum (in a good way).",
  "Ancient wisdom resides here.",
  "You've seen things people wouldn't believe.",
  "OG status: Certified.",

  // New Wallet
  "Fresh off the blockchain boat.",
  "New wallet, who dis?",
  "Welcome to the party, pal.",
  "Clean slate. Don't mess it up.",
  "The journey of a thousand transactions begins with one mint.",

  // NFT Collector
  "JPEG connoisseur.",
  "Your gallery is bigger than the Louvre.",
  "Collecting digital dust bunnies.",
  "Art aficionado or hoarding problem? You decide.",
  "So many pixels, so little time.",

  // High Tx Count
  "Spamming the network or just busy?",
  "Your F5 key must be broken.",
  "Transaction history longer than a CVS receipt.",
  "The network validators thank you for your service.",
  "Can't stop, won't stop transacting.",

  // Defi King
  "Yield farmer extraordinaire.",
  "Your blood type is APY+.",
  "Staking, baking, and making it rain.",
  "Impermanent loss? Never heard of her.",
  "Liquidity provider by day, Degen by night.",

  // Paper Hands
  "Sold the bottom? We've all been there.",
  "Buy high, sell low. This is the way.",
  "Panic seller of the year.",
  "Next time, try gluing your hands to the keyboard.",
  "Folding faster than a lawn chair.",

  // Solana Specific
  "Faster than a speeding bullet, cheaper than a gumball.",
  "Congestion? What congestion?",
  "Proof of History? More like Proof of Wizardry.",
  "Solana Summer never ended for you.",
  "You survived the outages. You are a survivor.",

  // Moonboy
  "Wen Lambo?",
  "To the moon! (Eventually).",
  "Rocket emojis are financial advice, right?",
  "Packing your bags for Alpha Centauri.",
  "Gravity is just a suggestion.",

  // Bear Market Survivor
  "You ate ramen so your wallet could eat dips.",
  "Winter is coming? You were born in the blizzard.",
  "Down 90%? Just a scratch.",
  "Diamond hands forged in the fires of the bear.",
  "Still here. Still building. Still poor. (Jk).",

  // Random / Absurdist
  "Your wallet radiates chaotic good energy.",
  "If this wallet could talk, it would scream.",
  "A black hole of productivity.",
  "Digital hoarding is a lifestyle choice.",
  "404: Financial Advice Not Found.",
  "Loading wealth... Please wait...",
  "Your private key is 'password123', right? (Kidding!).",
  "Don't click links. Seriously. Don't.",
  "Slippage tolerance: 100%.",
  "You are the main character of this blockchain.",
  "Only up. Or down. Definitely to the right.",
  "Financial stability is overrated anyway.",
  "You minted a rug, didn't you?",
  "Looks rare. Probably isn't.",
  "Right click, save as. You wouldn't download a car.",
  "Web3 native? More like Web3 captive.",
  "Touching grass is not in your roadmap.",
  "Sleep is for people with low gas fees.",
  "You check the charts more than your messages.",
  "Portfolio diversification: 100% meme coins.",
  "Risk management? We don't do that here.",
  "Leverage is a hell of a drug.",
  "Liquidation is just a forced fresh start.",
  "Your wallet address is prettier than your face. (No offense).",
  "Zero knowledge proof? You have zero knowledge of what you're doing.",
  "Smart contracts, not so smart investments.",
  "Decentralized and disorganized.",
  "Not your keys, not your... wait, where are my keys?",
  "Hacked? No, just bad at math.",
  "Rugpull resistant (mostly).",
  "Future billionaire or future hobo. No in-between.",
  "Wagmi. Probably. Maybe.",
  "Ngmi. Just kidding. Wagmi.",
  "Ser, this is a Wendy's.",
  "Gm. Gn. Ga.",
  "LFG (Looking For Gains).",
  "Your wallet has more activity than a beehive.",
  "Queen bee of the blockchain.",
  "Buzzing with potential.",
  "Sweet gains.",
  "Stinging losses.",
  "Honey, I shrunk the portfolio.",
  "Bee-lieve in something.",
  "Pollinating the ecosystem.",
  "Hive mind investor.",
  "Worker bee of the web3 world.",
  "Sleep is for the weak, trading is for the strong.",
  "Buy high, sell low, cry later.",
  "Chart watching level: Obsessive.",
  "Your refresh button is worn out.",
  "Living life one block at a time.",
  "Risk assessment: nonexistent.",
  "Portfolio volatility: Yes.",
  "You speak binary better than English.",
  "Compiling wealth...",
  "404: Poverty not found.",
  "Git commit -m 'Got rich'.",
  "Sudo make me a sandwich.",
  "Are we human, or are we just wallets?",
  "What is the meaning of life? 42 SOL.",
  "We are all just dust in the mempool.",
  "In the long run, we are all dead (wallets).",
  "To be or not to be (liquidated).",
  "Nice wallet. Shame about the face. (Kidding!)",
  "You look like you know what you're doing. Do you?",
  "Fake it 'til you make it (or mint it).",
  "This wallet is Rated R for Rekt.",
  "Warning: Contains high levels of hopium.",
  "Batteries not included.",
  "Void where prohibited.",
  "Objects in wallet are smaller than they appear.",
  "May contain nuts (and bolts).",
  "Hand wash only.",
  "Do not bleach.",
  "Keep away from open flame (and burn wallets).",
  "Store in a cool, dry place.",
  "Best before: never.",
  "Made in the metaverse.",
  "100% organic, grass-fed SOL.",
  "Gluten-free assets.",
  "No preservatives added.",
  "Just add water (and liquidity).",
  "Shake well before using.",
  "For external use only.",
  "Side effects may include nausea, dizziness, and sudden wealth.",
  "Ask your doctor if Solana is right for you.",
  "Keep out of reach of children (and hackers).",
  "Do not operate heavy machinery while trading.",
  "Don't drink and mint.",
  "Buckle up, buttercup.",
  "Hold on to your butts.",
  "Beam me up, Scotty.",
  "I am your father (of this wallet).",
  "Use the force, Luke.",
  "Live long and prosper.",
  "May the odds be ever in your favor.",
  "Winter is coming.",
  "You know nothing, Jon Snow.",
  "Dracarys.",
  "I drink and I know things.",
  "Chaos is a ladder.",
  "Not all who wander are lost (some are just bridge-hopping).",
  "One does not simply walk into Mordor (without gas).",
  "My precious.",
  "You shall not pass (without fees).",
  "Fly, you fools.",
  "I have a bad feeling about this.",
  "It's a trap!",
  "Do or do not. There is no try.",
  "The force is strong with this one.",
  "I find your lack of faith disturbing.",
  "Help me, Obi-Wan Kenobi. You're my only hope.",
  "Chewie, we're home.",
  "Never tell me the odds.",
  "It's not my fault.",
  "I've got a bad feeling about this.",
  "Great, kid. Don't get cocky.",
  "Stay on target.",
  "It's a trap!",
  "Unlimited power!",
  "I am the Senate.",
  "Hello there.",
  "General Kenobi.",
  "So uncivilized.",
  "I hate sand.",
  "This is where the fun begins.",
  "I have the high ground.",
  "You were the chosen one!",
  "I love democracy.",
  "Do it.",
  "I am inevitable.",
  "I am Iron Man.",
  "Avengers, assemble.",
  "Wakanda forever.",
  "I can do this all day.",
  "On your left.",
  "That is America's ass.",
  "I went for the head.",
  "We're in the endgame now.",
  "Whatever it takes.",
  "I love you 3000.",
  "He's a friend from work.",
  "Smash.",
  "Puny god.",
  "Dormammu, I've come to bargain.",
  "Dance off, bro.",
  "I am Groot.",
  "We are Groot.",
  "Perfectly balanced, as all things should be.",
  "Reality is often disappointing.",
  "A small price to pay for salvation.",
  "They called me a madman.",
  "The hardest choices require the strongest wills.",
  "Fun isn't something one considers when balancing the universe.",
  "You should have gone for the head.",
  "I don't feel so good.",
  "Mr. Stark, I don't feel so good.",
  "Why is Gamora?",
  "Kick names, take ass.",
  "It's invisible.",
  "Trash panda.",
  "Harbulary batteries.",
  "Taserface.",
  "Mary Poppins, y'all.",
  "He may be your father, boy, but he wasn't your daddy.",
  "I'm Mary Poppins, y'all!",
];

export function getRandomFunnyFact(traits: WalletTraits): string {
  // Try to find specific context-aware jokes first
  const specificFacts: string[] = [];

  if (traits.hasPreorder && !traits.hasSeeker) {
    specificFacts.push(
      "Preordered the future, but the Seeker is still seeking you.",
      "Visionary status: Confirmed. Seeker status: 404 Not Found.",
      "All dressed up with a Preorder, but no Seeker to go.",
      "Preorder secured. Seeker... distinct possibility of maybe.",
      "Got the Preorder badge, but the Seeker is playing hard to get."
    );
  }

  if (traits.isWhale) {
    specificFacts.push(
      "You have enough SOL to influence the tides.",
      "Warning: Heavy wallet. Lift with your legs.",
      "Whale alert! Harpoons not included."
    );
  }

  if (traits.solBalance < 0.1) {
    specificFacts.push(
      "Running on hopes, dreams, and dust.",
      "Gas money? barely.",
      "Keeping it lean. Very, very lean."
    );
  }

  if (traits.walletAgeDays > 730) {
    specificFacts.push(
      "You remember when SOL was single digits.",
      "This wallet belongs in a museum (in a good way).",
      "OG status: Certified."
    );
  }

  if (traits.nftCount > 50) {
    specificFacts.push(
      "JPEG connoisseur.",
      "Your gallery is bigger than the Louvre.",
      "Art aficionado or hoarding problem? You decide."
    );
  }

  // mix in some random ones if we don't have many specifics
  if (specificFacts.length < 3) {
    return FUNNY_FACTS[Math.floor(Math.random() * FUNNY_FACTS.length)];
  }

  // 40% chance of a specific fact if available, otherwise random
  if (Math.random() < 0.4 && specificFacts.length > 0) {
    return specificFacts[Math.floor(Math.random() * specificFacts.length)];
  }

  return FUNNY_FACTS[Math.floor(Math.random() * FUNNY_FACTS.length)];
}
