const base = require("./app.json");

module.exports = () => {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const androidConfig = {
    ...(base.expo.android?.config ?? {}),
  };

  if (googleMapsApiKey) {
    androidConfig.googleMaps = { apiKey: googleMapsApiKey };
  }

  return {
    ...base.expo,
    android: {
      ...base.expo.android,
      config: androidConfig,
    },
  };
};
