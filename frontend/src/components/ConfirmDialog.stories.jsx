import ConfirmDialog from "./ConfirmDialog";

export default {
  title: "Components/ConfirmDialog",
  component: ConfirmDialog,
};

export const ConfirmRefund = {
  args: { open: true, title: "Confirm refund", description: "Return 80 XLM to the original payer.", onConfirm() {}, onCancel() {} },
};
