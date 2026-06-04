import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function AppIndex() {
  const fetcher = useFetcher();
  const [quantity, setQuantity] = useState(1);
  const cardItem = {
    title: "314 - The Ouimet Performance Cap / White",
    unitPrice: 22.0,
  };

  useEffect(() => {
    if (fetcher.data?.invoiceUrl && !fetcher.data?.userErrors?.length) {
      if (window.top) {
        window.top.location.href = fetcher.data.invoiceUrl;
        return;
      }

      window.location.href = fetcher.data.invoiceUrl;
    }
  }, [fetcher.data]);

  const submitCheckout = () => {
    fetcher.submit(
      {
        title: cardItem.title,
        quantity: String(quantity),
        unitPrice: String(cardItem.unitPrice),
        note: "Customizer draft order",
      },
      {
        method: "post",
        action: "/api/draft-order",
      },
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Draft Order Card Checkout</h1>

      <div
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 12,
          padding: 16,
          maxWidth: 440,
          background: "#fff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>{cardItem.title}</h2>
        <p style={{ marginBottom: 8 }}>
          Unit price: ${cardItem.unitPrice.toFixed(2)}
        </p>

        <label htmlFor="qty">Quantity</label>
        <input
          id="qty"
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value) || 1)}
          style={{ display: "block", margin: "8px 0 12px", width: 100 }}
        />

        <p style={{ marginTop: 0, marginBottom: 16 }}>
          Total: ${(cardItem.unitPrice * quantity).toFixed(2)}
        </p>

        <button disabled={fetcher.state !== "idle"} onClick={submitCheckout}>
          {fetcher.state !== "idle" ? "Creating draft order..." : "Checkout"}
        </button>
      </div>

      {fetcher.data?.userErrors?.length > 0 && (
        <pre style={{ marginTop: 20, color: "#b42318" }}>
          {JSON.stringify(fetcher.data.userErrors, null, 2)}
        </pre>
      )}

      {fetcher.data && (
        <pre style={{ marginTop: 20 }}>
          {JSON.stringify(fetcher.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
