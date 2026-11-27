import PaymentFailureBanner from "./PaymentFailureBanner";

export default {
  title: "Components/PaymentFailureBanner",
  component: PaymentFailureBanner,
};

export const Failed = {
  args: { severity: "error", title: "Payment failed", message: "The transaction expired before it reached the ledger." },
};
