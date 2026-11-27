import FilterChips from "./FilterChips";

export default {
  title: "Components/FilterChips",
  component: FilterChips,
};

export const ActiveFilters = {
  args: { filters: [{ key: "status", label: "Status", value: "Paid" }, { key: "class", label: "Class", value: "Grade 5" }], onRemove() {}, onClearAll() {} },
};
