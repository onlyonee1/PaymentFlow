import "../src/styles/globals.css";
import "../src/styles/redesign.css";
import i18n from "../src/i18n";

void i18n.changeLanguage("en");

export default {
  parameters: {
    layout: "padded",
    chromatic: { disableSnapshot: false },
  },
};
