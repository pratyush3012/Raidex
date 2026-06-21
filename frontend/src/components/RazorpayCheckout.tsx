import React, { useMemo } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type Props = {
  keyId: string;
  orderId: string;
  amountInr: number;
  name: string;
  email: string;
  description?: string;
  onSuccess: (result: RazorpaySuccess) => void;
  onFailure: (reason: string) => void;
};

/**
 * Opens Razorpay Standard Checkout inside a WebView.
 * Works on iOS, Android, and web without a native Razorpay SDK.
 */
export function RazorpayCheckout({
  keyId,
  orderId,
  amountInr,
  name,
  email,
  description = "Raidex booking payment",
  onSuccess,
  onFailure,
}: Props) {
  const amountPaise = Math.round(amountInr * 100);

  const html = useMemo(() => {
    const opts = JSON.stringify({
      key: keyId,
      order_id: orderId,
      amount: amountPaise,
      currency: "INR",
      name: "Raidex",
      description,
      prefill: { name, email },
      theme: { color: "#05C46B" },
    });
    return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#fff}</style>
</head><body>
<p>Opening secure checkout…</p>
<script>
  function post(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }
  try {
    var options = ${opts};
    options.handler = function(res) {
      post({ type: "success", data: res });
    };
    options.modal = {
      ondismiss: function() { post({ type: "dismissed" }); }
    };
    var rzp = new Razorpay(options);
    rzp.on("payment.failed", function(resp) {
      post({ type: "failure", reason: (resp.error && resp.error.description) || "Payment failed" });
    });
    rzp.open();
  } catch (e) {
    post({ type: "failure", reason: e.message || "Could not open checkout" });
  }
</script>
</body></html>`;
  }, [keyId, orderId, amountPaise, name, email, description]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "success" && msg.data) {
        onSuccess({
          razorpay_payment_id: msg.data.razorpay_payment_id,
          razorpay_order_id: msg.data.razorpay_order_id,
          razorpay_signature: msg.data.razorpay_signature,
        });
      } else if (msg.type === "failure") {
        onFailure(msg.reason || "Payment failed");
      } else if (msg.type === "dismissed") {
        onFailure("Payment cancelled");
      }
    } catch {
      onFailure("Invalid payment response");
    }
  };

  return (
    <View style={styles.wrap}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://raidex.in" }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#05C46B" />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
});
