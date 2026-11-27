import Head from "next/head";
import Link from "next/link";

export default function Upgrade() {
  return (
    <main className="page-wrap">
      <Head><title>Upgrade student capacity | PaymentFlow</title></Head>
      <section className="card">
        <h1>Upgrade student capacity</h1>
        <p>Ask your PaymentFlow account administrator to change your subscription or set a custom student limit for your school.</p>
        <ul>
          <li>Free supports 100 active students.</li>
          <li>Standard supports 1,000 active students.</li>
          <li>Enterprise includes unlimited active students.</li>
        </ul>
        <Link href="/dashboard">Back to dashboard</Link>
      </section>
    </main>
  );
}
