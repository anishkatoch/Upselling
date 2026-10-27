/** Plain-English definitions shown in the "i" tooltips, so every number can be explained in one line. */
export const METRIC_INFO = {
  recordings: "How many sales recordings have been listened to. One recording can hold several customer conversations.",
  conversations: "The separate customer conversations found inside the recordings.",
  upsell_rate: "In how many of the customer conversations the salesperson offered something extra. Giving the customer what they asked for doesn't count.",
  acceptance_rate: "Of the offers where the customer clearly said yes or no, how many got a yes. Offers left undecided aren't counted.",
  unanswered: "Conversations where the customer asked something the salesperson never actually answered. A conversation counts once, however many questions were ignored in it. Fewer is better.",
  greeting_rate: "In how many of the conversations the salesperson greeted the customer near the start.",
  frustration: "How tense the customer got at the worst moment of the conversation, judged from their words and voice. Calm is best; Frustrated means the customer was clearly unhappy.",
  effort: "How hard the salesperson works at selling: how many offers they make, how many different approaches they try, whether they try again after a no, and how they handle objections.",
  offers_per_conversation: "How many offers the salesperson makes in an average customer conversation.",
  pitch_after_no: "Conversations where the salesperson kept pitching after the customer had clearly said no. Fewer is better.",
  reoffers: "How many times the salesperson offered the same thing again after the customer had said no.",
  techniques: "How many different ways of selling they have used, such as a bundle, an upgrade or a warranty.",
  pushy: "Conversations where the salesperson kept pushing after a clear no, or while the customer was getting unhappy.",
  rating: "A quick read on how they are doing, worked out from the figures with fixed rules. Use it as a prompt for a conversation, not a verdict, and check the conversations behind it.",
} as const;

export type MetricKey = keyof typeof METRIC_INFO;
