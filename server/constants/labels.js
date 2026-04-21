const TREASURY_WALLETS = new Set([
  '2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN',
]);

const KNOWN_LABELS = {
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': { label: 'Binance', type: 'cex' },
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': { label: 'Binance Hot', type: 'cex' },
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': { label: 'Binance', type: 'cex' },
  'H8sMJSCQxfKbeSTMe3fPaFKBMq3pS3bhVwn9dSjYqYLn': { label: 'Coinbase', type: 'cex' },
  'GJRs4FwHtemZ5ZE9Q3MNTDzoH7VDrKEswLzVRSJNDRLZ': { label: 'Coinbase', type: 'cex' },
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': { label: 'Kraken', type: 'cex' },
  '6FEVkH18iu1gKLksoKHiYq4VJFL6Lr2VkqhqRMp4VEto': { label: 'OKX', type: 'cex' },
  'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': { label: 'Bybit', type: 'cex' },
  'BmFdpraQhkiDQE6SnfG5PVb197fsGoiASaQUq8JEE6sB': { label: 'KuCoin', type: 'cex' },
  '88o1cLRMEDpbz1HZk8c5Ti6Rjs1yFhbqWrv5WmY5jdKm': { label: 'Gate.io', type: 'cex' },
  'HE1u8snzF1fPqtYVHSUGMsbiYFCYfXMVLJJDgGACrJHR': { label: 'Huobi', type: 'cex' },
  'BtQM6yeaU6B89RhMqYGasEJXEEXLjvwBpsHHRVxv9boW': { label: 'Bitget', type: 'cex' },
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { label: 'Jupiter', type: 'dex' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { label: 'Raydium', type: 'dex' },
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': { label: 'Wormhole', type: 'bridge' },
  'So1endDq2YkqhipRh3WViPa8hFvz0XP1MXF1VZU8Q4Mw': { label: 'Solend', type: 'dex' },
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': { label: 'Orca', type: 'dex' },
};

export {
  TREASURY_WALLETS,
  KNOWN_LABELS,
};
