import { useCallback, useEffect, useState } from "react";
import api from "../../services/api";
import PageHero from "../../components/PageHero";

const endpoint = "/payments/orphaned";

function errorMessage(error) {
  return error.response?.data?.error || "The request failed. Try again.";
}

function feeLabel(category) {
  return category ?? "Class fee";
}

function MatchForm({ payment, onMatch, onCancel }) {
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState(payment.suggestion?.studentId || "");
  const [fee, setFee] = useState(payment.suggestion ? JSON.stringify(payment.suggestion.feeCategory) : "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`${endpoint}/students`, {
          params: { search, includeStudentId: payment.suggestion?.studentId },
          signal: controller.signal,
        });
        setStudents(data);
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, payment.suggestion?.studentId]);

  const student = students.find(entry => entry.studentId === studentId);

  async function submit(event) {
    event.preventDefault();
    if (!student || !fee || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`${endpoint}/${payment._id}/match`, { studentId, feeCategory: JSON.parse(fee) });
      onMatch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Search students
        <input className="form-input" value={search} maxLength={100} onChange={event => {
          setSearch(event.target.value);
          setStudentId("");
          setFee("");
        }} />
      </label>
      <label>
        Student
        <select className="form-input" required value={studentId} onChange={event => {
          setStudentId(event.target.value);
          setFee("");
        }} disabled={loading || saving}>
          <option value="">{loading ? "Loading students…" : "Select a student"}</option>
          {students.map(entry => <option key={entry.studentId} value={entry.studentId}>{entry.name} ({entry.studentId})</option>)}
        </select>
      </label>
      <label>
        Fee
        <select className="form-input" required value={fee} onChange={event => setFee(event.target.value)} disabled={!student || saving}>
          <option value="">Select a fee</option>
          {student?.fees.map(choice => (
            <option key={JSON.stringify(choice.category)} value={JSON.stringify(choice.category)}>
              {feeLabel(choice.category)} ({choice.outstanding} outstanding)
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={!student || !fee || loading || saving}>
        {saving ? "Matching…" : "Confirm match"}
      </button>
      <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
    </form>
  );
}

export default function ReconciliationPage() {
  const [queue, setQueue] = useState(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(endpoint, { params: { page }, signal });
      if (page > 1 && data.payments.length === 0) setPage(page - 1);
      else setQueue(data);
    } catch (err) {
      if (!signal?.aborted) setError(errorMessage(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <PageHero title="Payment reconciliation" subtitle="Review Stellar payments awaiting a student and fee match." />
      <div className="page-wrap">
        {notice && <p role="status">{notice}</p>}
        {loading && <p role="status">Loading unmatched payments…</p>}
        {error && <p role="alert">{error} <button type="button" onClick={() => load()}>Reload</button></p>}
        {!loading && !error && queue?.payments.length === 0 && <p>No unmatched payments.</p>}
        {queue?.payments.map(payment => (
          <section className="card" key={payment._id}>
            <div className="card-body">
              <h2>{payment.amount} {payment.assetCode}</h2>
              <dl>
                <dt>Sender</dt><dd className="col-mono">{payment.sender || "Unknown"}</dd>
                <dt>Received</dt><dd><time dateTime={payment.receivedAt}>{new Date(payment.receivedAt).toLocaleString()}</time></dd>
                <dt>Memo</dt><dd>{payment.memo || "Missing"}</dd>
              </dl>
              <a href={payment.explorerUrl} target="_blank" rel="noreferrer">View on Stellar Expert</a>
              {payment.suggestion && (
                <p>Suggested match: {payment.suggestion.studentId} ({feeLabel(payment.suggestion.feeCategory)})</p>
              )}
              {selected === payment._id ? (
                <MatchForm payment={payment} onCancel={() => setSelected(null)} onMatch={() => {
                  setSelected(null);
                  setNotice("Payment matched.");
                  setQueue(previous => ({ ...previous, payments: previous.payments.filter(item => item._id !== payment._id) }));
                  void load();
                }} />
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => {
                  setNotice("");
                  setSelected(payment._id);
                }}>Match payment</button>
              )}
            </div>
          </section>
        ))}
        {(page > 1 || queue?.hasNext) && (
          <nav aria-label="Reconciliation pages">
            <button type="button" disabled={page === 1 || loading || Boolean(selected)} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page}</span>
            <button type="button" disabled={!queue?.hasNext || loading || Boolean(selected)} onClick={() => setPage(page + 1)}>Next</button>
          </nav>
        )}
      </div>
    </>
  );
}
