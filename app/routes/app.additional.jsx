import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          name
          invoiceUrl
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        input: {
          email: "test@example.com",
          note: "Draft order test",
          lineItems: [
            {
              title: "Custom Cap Build",
              quantity: 12,
              originalUnitPrice: "35.00",
            },
          ],
        },
      },
    },
  );

  const result = await response.json();
  return result;
};

export default function AdditionalPage() {
  const fetcher = useFetcher();

  return (
    <div style={{ padding: 24, background: "white", color: "black" }}>
      <h1>Draft Order Test</h1>
      <button onClick={() => fetcher.submit({}, { method: "post" })}>
        Create Draft Order
      </button>

      {fetcher.data && (
        <pre style={{ marginTop: 20 }}>
          {JSON.stringify(fetcher.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
