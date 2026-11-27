import Head from "next/head";
import PaymentForm from "../../components/PaymentForm";
import VerifyPayment from "../../components/VerifyPayment";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { schoolPath } from "../../config/seo";
import { getPublicSchools } from "../../services/publicSchools";
import { useTranslation } from "react-i18next";

// #1344 — shareable, bookmarkable payment status URL. Pre-fills the student
// lookup from the route param instead of requiring manual re-entry.
export default function PayFeesForStudent({ school, studentId }) {
  const { t } = useTranslation();
  // Track network connectivity to disable mutation actions while offline (Issue #269).
  const { isOnline } = useOnlineStatus();

  // Show skeleton while the router is hydrating and studentId isn't available yet.
  if (!router.isReady) {
    return (
      <>
        <Head><title>{t("nav.payFees")} | {t("app.name")}</title></Head>
        <div
          className="payfees-page"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t("actions.loading")}
        >
          <div className="payfees-header">
            <SkeletonBlock width={120} height={22} style={{ margin: "0 auto 0.75rem" }} />
            <SkeletonBlock width={280} height={36} style={{ margin: "0 auto 0.75rem" }} />
            <SkeletonBlock width={220} height={16} style={{ margin: "0 auto" }} />
          </div>
          <div className="payfees-grid">
            <SkeletonDetailCard rows={5} />
            <SkeletonDetailCard rows={3} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>{t("nav.payFees")} | {school?.name || t("app.name")}</title></Head>

      <div className="payfees-page">
        <div className="payfees-header">
          <span className="payfees-badge">
            <span className="payfees-badge-dot" />
            {t("payFees.liveOnStellar")}
          </span>
          <h1>{school?.name || t("payFees.heroTitle")}</h1>
          <p>{t(school && !studentId ? "payFees.heroDesc" : "payFees.studentHeroDesc")}</p>
        </div>

        <div className="payfees-grid">
          <PaymentForm key={school?.slug || studentId} initialStudentId={studentId} schoolSlug={school?.slug} disabled={!isOnline} />
          <VerifyPayment schoolSlug={school?.slug} disabled={!isOnline} />
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps({ params, query, res }) {
  const id = params.studentId;
  let school = null;
  if (id === id.toLowerCase()) {
    try {
      school = (await getPublicSchools()).find(({ slug }) => slug === id) || null;
    } catch {
      // A directory outage still permits existing shared student URLs.
    }
  }
  const studentId = school
    ? (typeof query.student === "string" ? query.student : "")
    : id;
  const canonicalPath = school && !query.student ? schoolPath("pay", school.slug) : null;
  if (!canonicalPath) res.setHeader("X-Robots-Tag", "noindex,nofollow");
  return { props: { school, studentId, canonicalPath } };
}
