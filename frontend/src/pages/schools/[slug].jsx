import Head from "next/head";
import Link from "next/link";
import { schoolPath } from "../../config/seo";
import { getPublicSchools } from "../../services/publicSchools";

export default function SchoolLanding({ school }) {
  return (
    <div className="payfees-page">
      <Head><title>{school.name} | PaymentFlow</title></Head>
      <h1>{school.name}</h1>
      <Link className="btn btn-primary" href={schoolPath("pay", school.slug)}>Pay school fees</Link>
    </div>
  );
}

export async function getServerSideProps({ params }) {
  const schools = await getPublicSchools();
  const school = schools.find(({ slug }) => slug === params.slug);
  if (!school) return { notFound: true };
  return { props: { school, canonicalPath: schoolPath("schools", school.slug) } };
}
