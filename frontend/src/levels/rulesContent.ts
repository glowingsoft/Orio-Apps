/**
 * Levels help / rules content. Arabic is the owner-provided source text;
 * English is a faithful translation. Each section: heading + paragraphs/bullets.
 */
export type RuleSection = { h?: string; p?: string[]; bullets?: string[]; numbered?: string[] };
export type RuleTab = { id: string; title: string; sections: RuleSection[] };

const AR: RuleTab[] = [
  {
    id: "wealth",
    title: "قواعد مستوى الثروة",
    sections: [
      { h: "1. ما هو مستوى الثروة؟", p: ["مستوى الثروة يعكس قيمة الهدايا التي ترسلها للآخرين داخل منصة ORIO، وكلما زاد إنفاقك للألماس على الهدايا، ارتفع مستوى ثروتك."] },
      { h: "2. كيف تحصل على نقاط الثروة؟", p: [
        "عند إرسال هدية مدفوعة بالألماس، تحصل تلقائيًا على نقاط ثروة مساوية لقيمة الهدية.",
        "كل 1 ألماسة = 1 نقطة ثروة.",
        "مثال: إرسال هدية بقيمة 10,000 ألماسة يمنحك 10,000 نقطة ثروة.",
      ] },
      { h: "3. ماذا يحدث عند ارتفاع مستوى الثروة؟", p: ["تتطور شارتك مع تقدمك في المستويات، وتظهر بتصاميم وألوان أكثر تميزًا لتعكس إنجازاتك داخل منصة ORIO. ويمكنك فتح مكافأة راقية عند تطور مستواك، وكلما ارتفع مستواك حصلت على مكافأة أرقى."] },
      { h: "4. تعليمات مهمة", bullets: [
        "تُحتسب نقاط الثروة عند إرسال الهدايا المدفوعة فقط.",
        "لا تمنح الهدايا المجانية نقاط ثروة.",
        "شراء الألماس أو شحنه لا يمنح نقاط ثروة حتى يتم استخدامه في إرسال الهدايا.",
        "يتم تحديث مستوى الثروة تلقائيًا.",
        "يمكنك متابعة نقاطك والمتبقي للمستوى التالي في أي وقت.",
      ] },
    ],
  },
  {
    id: "charm",
    title: "قواعد مستوى الجاذبية",
    sections: [
      { h: "1. ما هو مستوى الجاذبية؟", p: ["مستوى الجاذبية يعكس مقدار الدعم والهدايا التي تتلقاها من المستخدمين الآخرين داخل منصة ORIO، ويبرز مكانتك وتفاعلك في المجتمع."] },
      { h: "2. كيف تحصل على نقاط الجاذبية؟", p: [
        "عندما تستقبل هدية مدفوعة بالألماس، تحصل تلقائيًا على نقاط جاذبية مساوية لقيمة الهدية.",
        "كل 1 ألماسة = 1 نقطة جاذبية.",
        "مثال: استقبال هدية بقيمة 10,000 ألماسة يمنحك 10,000 نقطة جاذبية.",
      ] },
      { h: "3. ما الذي تحصل عليه عند الترقية؟", p: ["مع كل مرحلة جديدة، تتطور شارة الجاذبية الخاصة بك، لتصبح أكثر تميزًا وفخامة مع تقدم مستواك."] },
      { h: "4. تعليمات مهمة", bullets: [
        "تُحتسب نقاط الجاذبية عند استقبال الهدايا المدفوعة.",
        "لا تمنح الهدايا المجانية نقاط جاذبية.",
        "إرسال الهدايا لا يزيد نقاط جاذبيتك، بل يزيد نقاط ثروتك، إلا إذا أرسلت هدية لنفسك، فتحصل على نقاط الجاذبية بصفتك المستلم.",
        "يتم تحديث نقاط الجاذبية والمستوى تلقائيًا.",
        "يمكنك الاطلاع على تقدمك والنقاط المطلوبة للترقية من صفحة الجاذبية.",
      ] },
    ],
  },
  {
    id: "general",
    title: "قواعد المستوى العام",
    sections: [
      { h: "1. ما هو المستوى العام؟", p: ["المستوى العام يعكس تقدم حسابك ونشاطك داخل مجتمع منصة ORIO، ويعتمد على نقاط الخبرة المكتسبة من الأنشطة المؤهلة."] },
      { h: "2. كيف تحصل على نقاط الخبرة؟", p: ["يمكنك اكتساب نقاط الخبرة من الأنشطة التي يدعمها نظام المستوى العام داخل التطبيق."] },
      { h: "3. ما فائدة المستوى العام؟", p: ["يعكس المستوى العام تقدمك داخل منصة ORIO، ويمنح حسابك هوية مميزة تتطور مع وصولك إلى مستويات أعلى."] },
      { h: "4. تعليمات مهمة", bullets: [
        "لكل مستوى عدد محدد من نقاط الخبرة المطلوبة.",
        "تتم الترقية تلقائيًا عند اكتمال النقاط.",
        "يمكنك معرفة نقاطك الحالية والمتبقية للترقية.",
        "مستوى الثروة والجاذبية والمستوى العام أنظمة مستقلة عن بعضها.",
        "يتم الاحتفاظ بنقاط الخبرة المكتسبة وفق قواعد التطبيق.",
      ] },
    ],
  },
  {
    id: "rules",
    title: "القواعد العامة للمستويات",
    sections: [
      { h: "تعليمات وقواعد منصة ORIO", numbered: [
        "جميع النقاط والمستويات مرتبطة بالحساب الذي اكتسبها.",
        "تتم ترقية المستويات وتحديث الشارات تلقائيًا عند استيفاء متطلبات الترقية.",
        "لا يمكن نقل نقاط الثروة أو الجاذبية أو الخبرة بين الحسابات.",
        "يُمنع استخدام وسائل غير مشروعة للحصول على النقاط أو التلاعب بنظام المستويات.",
        "قد يتم تصحيح النقاط الناتجة عن المعاملات الملغاة أو غير الصحيحة.",
        "تحتفظ منصة ORIO بحق تحديث متطلبات المستويات ومزاياها مع حماية التقدم المشروع للمستخدمين.",
        "يمكنك استعراض جميع الشارات ومعرفة مستوى حسابك الحالي ومتطلبات الوصول إلى المستويات القادمة.",
      ] },
    ],
  },
];

const EN: RuleTab[] = [
  {
    id: "wealth",
    title: "Wealth Level Rules",
    sections: [
      { h: "1. What is the Wealth Level?", p: ["Your Wealth Level reflects the value of the gifts you send to others on ORIO. The more diamonds you spend on gifts, the higher your Wealth Level."] },
      { h: "2. How do you earn Wealth points?", p: [
        "When you send a paid diamond gift, you automatically earn Wealth points equal to the gift's value.",
        "1 Diamond = 1 Wealth point.",
        "Example: sending a gift worth 10,000 diamonds gives you 10,000 Wealth points.",
      ] },
      { h: "3. What happens when your Wealth Level rises?", p: ["Your badge evolves as you progress, with more distinctive designs and colors that reflect your achievements on ORIO. You can unlock an elegant reward as your level grows, and the higher your level, the finer the reward."] },
      { h: "4. Important notes", bullets: [
        "Wealth points are counted only when sending paid gifts.",
        "Free gifts do not award Wealth points.",
        "Buying or recharging diamonds does not award Wealth points until they are used to send gifts.",
        "Your Wealth Level updates automatically.",
        "You can track your points and what remains for the next level at any time.",
      ] },
    ],
  },
  {
    id: "charm",
    title: "Charm Level Rules",
    sections: [
      { h: "1. What is the Charm Level?", p: ["Your Charm Level reflects the support and gifts you receive from other users on ORIO, highlighting your standing and engagement in the community."] },
      { h: "2. How do you earn Charm points?", p: [
        "When you receive a paid diamond gift, you automatically earn Charm points equal to the gift's value.",
        "1 Diamond = 1 Charm point.",
        "Example: receiving a gift worth 10,000 diamonds gives you 10,000 Charm points.",
      ] },
      { h: "3. What do you get when you level up?", p: ["With every new stage, your Charm badge evolves, becoming more distinctive and luxurious as your level advances."] },
      { h: "4. Important notes", bullets: [
        "Charm points are counted when receiving paid gifts.",
        "Free gifts do not award Charm points.",
        "Sending gifts does not increase your Charm points, it increases your Wealth points — unless you send a gift to yourself, in which case you earn Charm points as the recipient.",
        "Charm points and level update automatically.",
        "You can view your progress and the points needed to level up on the Charm page.",
      ] },
    ],
  },
  {
    id: "general",
    title: "General Level Rules",
    sections: [
      { h: "1. What is the General Level?", p: ["The General Level reflects your account's progress and activity in the ORIO community, based on experience points earned from eligible activities."] },
      { h: "2. How do you earn experience points?", p: ["You can earn experience points from the activities supported by the General Level system in the app."] },
      { h: "3. What is the General Level for?", p: ["The General Level reflects your progress on ORIO and gives your account a distinctive identity that evolves as you reach higher levels."] },
      { h: "4. Important notes", bullets: [
        "Each level requires a specific number of experience points.",
        "You level up automatically once the points are complete.",
        "You can see your current points and what remains to level up.",
        "Wealth, Charm and General levels are independent systems.",
        "Earned experience points are kept according to the app's rules.",
      ] },
    ],
  },
  {
    id: "rules",
    title: "General Rules for Levels",
    sections: [
      { h: "ORIO Platform Rules", numbered: [
        "All points and levels belong to the account that earned them.",
        "Levels are upgraded and badges updated automatically once upgrade requirements are met.",
        "Wealth, Charm and experience points cannot be transferred between accounts.",
        "Using illegitimate means to gain points or manipulate the level system is prohibited.",
        "Points resulting from cancelled or invalid transactions may be corrected.",
        "ORIO reserves the right to update level requirements and benefits while protecting users' legitimate progress.",
        "You can browse all badges and see your current level and the requirements for upcoming levels.",
      ] },
    ],
  },
];

export const levelRules = (lang: string): RuleTab[] => (lang === "ar" ? AR : EN);
