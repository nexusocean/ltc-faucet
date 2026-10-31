import { RpcCallError, type LitecoinRpcClient } from '@nexusocean/litecoin-rpc';
import type { ClaimStore } from './claims.js';

export type FaucetRpc = Pick<
  LitecoinRpcClient,
  'validateAddress' | 'sendToAddress' | 'getBalance'
>;

export type ClaimResult =
  | { status: 'sent'; txid: string; amount: number }
  | { status: 'invalid-address' }
  | { status: 'rate-limited'; retryAt: Date }
  | { status: 'empty' }
  | { status: 'unavailable' };

export interface Faucet {
  claim(address: string, ip: string): Promise<ClaimResult>;
  balance(): Promise<number>;
}

const RPC_WALLET_INSUFFICIENT_FUNDS = -6;

interface Logger {
  error(obj: unknown, msg?: string): void;
}

export function createFaucet(opts: {
  rpc: FaucetRpc;
  store: ClaimStore;
  amount: number;
  log: Logger;
}): Faucet {
  const { rpc, store, amount, log } = opts;

  return {
    async claim(rawAddress, ip) {
      const address = rawAddress.trim();

      // Only bech32 testnet addresses (tltc1…); no legacy m…/n…/Q… ones.
      if (!address.toLowerCase().startsWith('tltc1')) return { status: 'invalid-address' };

      // The node only accepts addresses for its own network, so this also
      // rejects mainnet addresses on a testnet node.
      const { isvalid } = await rpc.validateAddress(address);
      if (!isvalid) return { status: 'invalid-address' };

      const reservation = await store.reserve(ip, address);
      if (!reservation.ok) {
        return { status: 'rate-limited', retryAt: reservation.retryAt };
      }

      let txid: string;
      try {
        txid = await rpc.sendToAddress(address, amount);
      } catch (err) {
        // Only release when the node answered with an error, i.e. nothing was
        // sent. On a timeout or dropped connection the send may have gone
        // through, so keep the reservation rather than risk paying twice.
        const nodeRejected = err instanceof RpcCallError && err.httpStatus !== undefined;
        if (nodeRejected) {
          await store.release(reservation.id).catch((e: unknown) => {
            log.error(e, 'failed to release claim');
          });
        }
        log.error(err, 'sendToAddress failed');
        if (err instanceof RpcCallError && err.code === RPC_WALLET_INSUFFICIENT_FUNDS) {
          return { status: 'empty' };
        }
        return { status: 'unavailable' };
      }

      await store.complete(reservation.id, txid).catch((e: unknown) => {
        log.error(e, 'failed to record txid');
      });
      return { status: 'sent', txid, amount };
    },

    balance: () => rpc.getBalance(),
  };
}
