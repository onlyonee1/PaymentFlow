import DataTable from "./DataTable";

export default {
  title: "Components/DataTable",
  component: DataTable,
};

export const Payments = {
  args: {
  tableId: "storybook-payments",
  caption: "Recent payments",
  showCaption: true,
  columns: [{ key: "student", header: "Student" }, { key: "amount", header: "Amount", align: "right" }],
  rows: [{ student: "Alex Rivera", amount: "125 XLM" }, { student: "Sam Lee", amount: "80 XLM" }],
},
};
