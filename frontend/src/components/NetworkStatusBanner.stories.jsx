import NetworkStatusBanner from "./NetworkStatusBanner";

export default {
  title: "Components/NetworkStatusBanner",
  component: NetworkStatusBanner,
};

export const Offline = {
  args: { isOnline: false, wasOffline: false },
};
