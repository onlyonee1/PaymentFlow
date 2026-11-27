import { useState, useEffect } from 'react';
import { getConversionRates } from '../services/api';

/**
 * Fetches the XLM→USD conversion rate and computes a fiat amount for a given
 * XLM amount. Clears stale state immediately when xlmAmount changes so the
 * previous value never flashes during a new fetch.
 *
 * @param {number|null} xlmAmount – XLM amount to convert. null/0 returns idle state.
 * @returns {{ fiatAmount: number|null, rate: number|null, currency: string, loading: boolean, error: string|null }}
 */
export function useFiatConversion(xlmAmount) {
  const [fiatAmount, setFiatAmount] = useState(null);
  const [rate, setRate]             = useState(null);
  const [currency, setCurrency]     = useState('USD');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  useEffect(() => {
    // Clear stale values synchronously before any async work.
    setFiatAmount(null);
    setRate(null);
    setError(null);

    if (xlmAmount == null || xlmAmount <= 0) {
      setLoading(false);
      return;
    }

    setLoading(true);

    getConversionRates()
      .then(({ data }) => {
        const fetchedRate = data?.rates?.USD ?? data?.USD ?? null;
        if (fetchedRate == null) throw new Error('Rate unavailable');
        setRate(fetchedRate);
        setCurrency('USD');
        setFiatAmount(parseFloat((xlmAmount * fetchedRate).toFixed(2)));
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch conversion rate');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [xlmAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  return { fiatAmount, rate, currency, loading, error };
}

export default useFiatConversion;
