/** Plain-English definitions shown in the "i" tooltips, so every number can be explained in one line. */
export const METRIC_INFO = {
  recordings: "Recordings that have been analysed. Each recording can contain several customer conversations.",
  conversations: "Separate customer conversations found inside the recordings.",
  upsell_rate: "The share of analysed conversations where the salesperson offered something beyond what the customer asked for. Fulfilling a request is not counted.",
  acceptance_rate: "Offers the customer accepted, out of offers the customer clearly answered yes or no to. Undecided offers are left out.",
  greeting_rate: "The share of conversations where the salesperson greeted the customer near the start.",
  frustration: "How frustrated the customer got at the worst point, from 0 (calm) to 10 (very frustrated). Based on their words and voice.",
  effort: "How actively and persistently they sell, from 0 to 10: number of offers, variety of approaches, trying again after a no, and handling objections.",
  offers_per_conversation: "Average number of offers made in each analysed conversation.",
  reoffers: "Times the same customer was offered something again after saying no.",
  techniques: "Different selling approaches used, such as a bundle, an upgrade or a warranty.",
  pushy: "Conversations where the salesperson kept pushing after a clear no or while the customer was getting frustrated.",
  rating: "A quick read from the numbers above using fixed rules. It is a prompt for a conversation, not a verdict. Check the conversations behind it.",
} as const;

export type MetricKey = keyof typeof METRIC_INFO;
