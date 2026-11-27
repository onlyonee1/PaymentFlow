import AccessiblePagination from "./AccessiblePagination";

export default {
  title: "Components/AccessiblePagination",
  component: AccessiblePagination,
};

export const MiddlePage = {
  args: { currentPage: 3, totalPages: 8, total: 80, rangeStart: 21, rangeEnd: 30, onPageChange() {} },
};
