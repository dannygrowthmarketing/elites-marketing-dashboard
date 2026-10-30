// Elites Dental Care: what the Business Profile page groups reviews and searches by.
// Review themes are Postgres regexes (case-insensitive) matched against the review text.
export const GBP_CONFIG = {
  intro: "Elites Dental Care, CMS Towers, TC Palya Main Rd. Calls are taps on the Call button, not answered calls. Views count per day, so one person on two days counts twice.",
  brand: /elite/i,
  reviewThemes: [
    { label: "Doctor", re: "doctor|\\mdr\\M|dentist|explain|expert|skilled|knowledge" },
    { label: "Staff & front desk", re: "staff|reception|team|assistant|friendly|polite|rude|courteous" },
    { label: "Pain & comfort", re: "pain|painless|comfort|gentle|hurt|scared|fear|anxious|relax|smooth" },
    { label: "Clean & modern", re: "clean|hygien|steril|modern|equipment|ambience|neat" },
    { label: "Price & value", re: "price|cost|charge|afford|expens|reasonable|value|money|billing" },
    { label: "Waiting time", re: "wait|on time|punctual|delay|appointment|quick|late" },
    { label: "Root canal", re: "root canal|rct" },
    { label: "Implants", re: "implant" },
    { label: "Braces & aligners", re: "brace|aligner|invisalign|orthodont" },
    { label: "Cleaning & whitening", re: "cleaning|scaling|whiten|polish" },
    { label: "Kids", re: "kid|child|\\mson\\M|daughter|baby|paediatric|pediatric" },
  ],
  // First match wins, so specific groups come before the generic "dentist near me".
  searchGroups: [
    { label: "Competitor names", re: /clove|kks|matiri|sabka|apollo white|partha|mydentist/i },
    { label: "Kids dentist", re: /kid|child|pediatric|paediatric/i },
    { label: "Implants", re: /implant/i },
    { label: "Root canal", re: /root canal|rct/i },
    { label: "Braces & aligners", re: /brace|aligner|invisalign|orthodont/i },
    { label: "Cleaning & whitening", re: /clean|scaling|whiten/i },
    { label: "Emergency & pain", re: /emergency|pain|24 ?hours|open now/i },
    { label: "Dentist near me", re: /dentist|dental clinic|dental hospital|dental care|teeth doctor|tooth doctor/i },
  ],
};
