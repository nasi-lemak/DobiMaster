/**
 * Privacy notice and terms of use. DRAFT: written to match what DobiMaster actually stores and does,
 * but not reviewed by a lawyer yet. See docs/LEGAL-REVIEW.md before relying on it.
 *
 * The PDPA (s.7(3)) requires the privacy notice in both Bahasa Malaysia and English; 中文 is a courtesy.
 * Operator details and retention periods come from the server (GET /public/legal), so the text always
 * matches the server's settings and the daily deletion job.
 */

export interface LegalInfo {
  operatorName: string | null;
  registrationNo: string | null;
  address: string | null;
  contactEmail: string | null;
  dataLocation: string;
  version: string;
  retention: { contactPhoneDays: number; ticketPhotoDays: number; waContactDays: number; waMessageDays: number };
}

/** A paragraph, or a bullet list. */
export type Block = string | string[];
export interface Section {
  h: string;
  blocks: Block[];
}
export interface LegalDoc {
  title: string;
  intro: Block[];
  sections: Section[];
}
export type LegalLocale = 'en' | 'ms' | 'zh';

const NOT_SET = '[not set]';
const name = (i: LegalInfo) => i.operatorName ?? NOT_SET;
const email = (i: LegalInfo) => i.contactEmail ?? NOT_SET;
const identity = (i: LegalInfo) => [name(i) + (i.registrationNo ? ` (${i.registrationNo})` : ''), i.address].filter(Boolean).join(', ');

// ---------------------------------------------------------------------------------------------
// Privacy notice

export function privacyNotice(locale: LegalLocale, i: LegalInfo): LegalDoc {
  const r = i.retention;
  if (locale === 'ms')
    return {
      title: 'Notis privasi',
      intro: [
        `Notis ini menerangkan data peribadi yang dikumpul oleh ${name(i)} ("kami") apabila anda menggunakan DobiMaster di kedai dobi layan diri, sebabnya, dan pilihan anda. Ia diberikan di bawah Akta Perlindungan Data Peribadi 2010 (PDPA). Notis ini tersedia dalam Bahasa Malaysia, English dan 中文.`,
      ],
      sections: [
        {
          h: '1. Siapa kami',
          blocks: [
            `${identity(i)}. Untuk sebarang perkara tentang data anda: ${email(i)}.`,
            'Setiap kedai dobi yang menggunakan DobiMaster diuruskan oleh pemiliknya sendiri. Apabila anda melaporkan masalah di sesebuah kedai, pemilik dan pekerja kedai itu melihat laporan anda supaya mereka boleh membaikinya atau membayar balik wang anda.',
          ],
        },
        {
          h: '2. Tiada akaun diperlukan',
          blocks: [
            'Tiada pendaftaran, nama atau e-mel. Kali pertama anda menggunakan aplikasi, telefon anda diberi ID rawak yang disimpan di telefon ini sahaja. Itulah cara kami mengingati pemasa dan laporan anda.',
          ],
        },
        {
          h: '3. Apa yang kami kumpul dan mengapa',
          blocks: [
            [
              'Pemasa yang anda mulakan (mesin, kedai, masa mula dan tamat): untuk menunjukkan kiraan detik, menghantar amaran, dan memberi kedai statistik penggunaan tanpa nama (waktu sibuk).',
              'Pemberitahuan: jika anda menghidupkannya, "alamat" pemberitahuan daripada pelayar anda, untuk menghantar amaran "hampir siap". Ia dihantar melalui perkhidmatan pemberitahuan pelayar anda (Google, Apple atau Mozilla).',
              'WhatsApp (jika anda memautkannya): nombor WhatsApp anda dan mesej yang anda hantar kepada kami, untuk menghantar amaran dobi melalui WhatsApp.',
              'Laporan masalah: apa yang berlaku, butiran pilihan dan sehingga 3 gambar; untuk bayaran balik, nombor telefon anda. Gambar disimpan semula di telefon anda sebelum dimuat naik, yang membuang data lokasi.',
              '"Beritahu saya bila kosong": saiz mesin yang anda tunggu, untuk memberitahu anda apabila satu kosong.',
              'Bayaran dalam aplikasi (hanya di kedai yang menawarkannya): jumlah, mesin dan keputusan. Butiran kad atau e-dompet dimasukkan di halaman penyedia pembayaran; kami tidak pernah melihatnya.',
              'Teknikal: alamat IP dan jenis pelayar dalam log pelayan, untuk keselamatan dan mencegah penyalahgunaan, disimpan untuk tempoh yang singkat.',
              'Pilihan bahasa, disimpan di telefon anda.',
            ],
          ],
        },
        {
          h: '4. Adakah ia wajib?',
          blocks: [
            'Semuanya pilihan. Tanpa pemberitahuan, anda tidak akan menerima amaran; tanpa nombor telefon, kedai tidak dapat menghantar bayaran balik. Syiling dan mesin berfungsi tanpa aplikasi ini.',
          ],
        },
        {
          h: '5. Dengan siapa kami berkongsi',
          blocks: [
            [
              'Pemilik dan pekerja kedai: laporan dan butiran bayaran balik anda; statistik penggunaan tanpa identiti anda.',
              `Penyedia perkhidmatan yang bertindak bagi pihak kami: pengehosan pelayan (${i.dataLocation}), perkhidmatan pemberitahuan pelayar, WhatsApp (Meta) jika anda memautkannya, penyedia pembayaran jika anda membayar dalam aplikasi.`,
              'Pihak berkuasa, jika dikehendaki oleh undang-undang.',
            ],
            'Kami tidak menjual data anda dan tidak menggunakan kuki pengiklanan atau penjejakan.',
          ],
        },
        {
          h: '6. Penyimpanan di luar Malaysia',
          blocks: [
            `Pelayan kami terletak di ${i.dataLocation}. Data dipindahkan ke sana untuk menjalankan perkhidmatan, dengan perlindungan: sambungan disulitkan (HTTPS) dan akses terhad kepada orang yang diberi kuasa.`,
          ],
        },
        {
          h: '7. Berapa lama kami menyimpannya',
          blocks: [
            [
              `Nombor telefon untuk bayaran balik: dipadam ${r.contactPhoneDays} hari selepas laporan ditutup.`,
              `Gambar laporan: dipadam ${r.ticketPhotoDays} hari selepas laporan ditutup.`,
              `WhatsApp: nombor anda dipadam selepas ${r.waContactDays} hari tanpa mesej daripada anda; log mesej disimpan ${r.waMessageDays} hari.`,
              'Pemasa dan bayaran: disimpan sebagai rekod perniagaan kedai; selepas anda memadam data anda, ia tidak lagi dikaitkan dengan anda.',
            ],
          ],
        },
        {
          h: '8. Pilihan dan hak anda',
          blocks: [
            [
              'Padam data saya: Dobi saya → "Padam data saya di telefon ini". Ini membuang ID, amaran, pautan WhatsApp dan peringatan anda serta-merta. Laporan masalah yang masih dibuka mengekalkan nombor telefon anda sehingga diselesaikan, supaya kedai masih boleh membayar balik wang anda.',
              'Hentikan amaran bila-bila masa: matikan pemberitahuan dalam pelayar anda, atau balas STOP di WhatsApp.',
              `Akses atau pembetulan: e-mel ${email(i)}. Kami akan membalas dalam masa 21 hari.`,
              'Aduan: anda juga boleh menghubungi Pesuruhjaya Perlindungan Data Peribadi (Jabatan Perlindungan Data Peribadi).',
            ],
          ],
        },
        {
          h: '9. Keselamatan',
          blocks: [
            'Semua sambungan disulitkan (HTTPS). Gambar dan nombor telefon hanya boleh dilihat oleh pekerja kedai yang berkenaan. Kata laluan disimpan dalam bentuk yang tidak boleh dibaca semula. Data disandarkan setiap malam.',
          ],
        },
        {
          h: '10. Pemilik dan pekerja kedai',
          blocks: [
            'Jika anda menggunakan papan pemuka pemilik: kami menyimpan nama, e-mel, kata laluan (dalam bentuk yang tidak boleh dibaca semula), peranti yang log masuk (jenis pelayar, alamat IP, masa terakhir digunakan), tindakan yang anda ambil (log audit, untuk akauntabiliti), gambar senarai semak, dan nombor WhatsApp jika dipautkan. Ia digunakan untuk menjalankan akaun anda dan menghantar ringkasan mingguan, dan disimpan selagi akaun anda aktif.',
          ],
        },
        {
          h: '11. Perubahan',
          blocks: ['Jika notis ini berubah, kami akan mengemas kini tarikh di atas dan memaklumkan perubahan penting dalam aplikasi.'],
        },
      ],
    };

  if (locale === 'zh')
    return {
      title: '隐私声明',
      intro: [
        `本声明说明当您在自助洗衣店使用 DobiMaster 时，${name(i)}（“我们”）收集哪些个人资料、原因以及您的选择。本声明依据马来西亚《2010年个人资料保护法》（PDPA）提供，并备有马来文、英文和中文版本。`,
      ],
      sections: [
        {
          h: '1. 我们是谁',
          blocks: [
            `${identity(i)}。有关您资料的任何事项，请联系：${email(i)}。`,
            '每家使用 DobiMaster 的洗衣店由其店主自行经营。当您在某家店报告问题时，该店的店主和员工会看到您的报告，以便维修或退款。',
          ],
        },
        { h: '2. 无需注册', blocks: ['无需注册、姓名或电邮。首次使用时，您的手机会获得一个只保存在本机的随机编号，我们以此记住您的计时和报告。'] },
        {
          h: '3. 我们收集什么、为什么',
          blocks: [
            [
              '您开始的计时（机器、店铺、开始和结束时间）：用于显示倒计时、发送提醒，并向店铺提供匿名使用统计（繁忙时段）。',
              '通知：如果您开启，浏览器提供的推送“地址”，用于发送“快好了”提醒。通知经由您浏览器的推送服务（Google、Apple 或 Mozilla）传送。',
              'WhatsApp（如您绑定）：您的 WhatsApp 号码及您发给我们的信息，用于通过 WhatsApp 发送洗衣提醒。',
              '问题报告：发生了什么、可选的说明和最多 3 张照片；如需退款，还有您的电话号码。照片在上传前会在您的手机上重新保存，从而去除位置信息。',
              '“有空位时通知我”：您等待的机器大小，用于在有空位时通知您。',
              '应用内付款（仅限提供此功能的店铺）：金额、机器和结果。银行卡或电子钱包资料在支付服务商的页面输入，我们从不接触。',
              '技术资料：服务器日志中的 IP 地址和浏览器类型，用于安全和防止滥用，仅短期保存。',
              '语言偏好，保存在您的手机上。',
            ],
          ],
        },
        { h: '4. 是否必须提供？', blocks: ['全部都是自愿的。不开启通知就收不到提醒；不提供电话号码，店铺就无法退款。不用本应用，投币和机器照常运作。'] },
        {
          h: '5. 我们与谁分享',
          blocks: [
            [
              '店主和员工：您的报告和退款资料；不含您身份的使用统计。',
              `代表我们提供服务的服务商：服务器托管（${i.dataLocation}）、浏览器推送服务、WhatsApp（Meta，如您绑定）、支付服务商（如您在应用内付款）。`,
              '法律要求时的有关当局。',
            ],
            '我们不出售您的资料，也不使用广告或追踪 Cookie。',
          ],
        },
        { h: '6. 在马来西亚境外存储', blocks: [`我们的服务器位于${i.dataLocation}。为提供服务，资料会传送至该处，并受到保护：连接全程加密（HTTPS），只有获授权人员可以访问。`] },
        {
          h: '7. 保存多久',
          blocks: [
            [
              `退款电话号码：报告结案后 ${r.contactPhoneDays} 天删除。`,
              `报告照片：报告结案后 ${r.ticketPhotoDays} 天删除。`,
              `WhatsApp：您 ${r.waContactDays} 天没有给我们发信息后删除您的号码；信息记录保存 ${r.waMessageDays} 天。`,
              '计时和付款：作为店铺的营业记录保存；您删除资料后，这些记录将不再与您关联。',
            ],
          ],
        },
        {
          h: '8. 您的选择和权利',
          blocks: [
            [
              '删除我的资料：我的洗衣 →“删除此手机上的资料”。您的编号、提醒、WhatsApp 绑定和等候提醒会立即删除。尚未处理完的问题报告会保留您的电话号码直到解决，以便店铺仍可退款给您。',
              '随时停止提醒：在浏览器中关闭通知，或在 WhatsApp 回复 STOP。',
              `查阅或更正：电邮 ${email(i)}。我们会在 21 天内回复。`,
              '投诉：您也可以联系个人资料保护专员（Jabatan Perlindungan Data Peribadi）。',
            ],
          ],
        },
        { h: '9. 安全', blocks: ['所有连接均加密（HTTPS）。照片和电话号码只有相关店铺的员工可以查看。密码以无法还原的形式保存。资料每晚备份。'] },
        {
          h: '10. 店主和员工',
          blocks: [
            '如果您使用店主后台：我们保存您的姓名、电邮、密码（以无法还原的形式）、已登录的设备（浏览器类型、IP 地址、最后使用时间）、您的操作记录（审计日志，用于问责）、清洁检查照片，以及已绑定的 WhatsApp 号码。这些资料用于运行您的账户和发送每周摘要，在账户有效期间保存。',
          ],
        },
        { h: '11. 变更', blocks: ['如本声明有变，我们会更新上方日期，并在应用内告知重要变更。'] },
      ],
    };

  return {
    title: 'Privacy notice',
    intro: [
      `This notice explains what personal data ${name(i)} ("we") collects when you use DobiMaster at a self-service laundry, why, and your choices. It is given under Malaysia's Personal Data Protection Act 2010 (PDPA), and is available in Bahasa Malaysia, English and 中文.`,
    ],
    sections: [
      {
        h: '1. Who we are',
        blocks: [
          `${identity(i)}. For anything about your data: ${email(i)}.`,
          'Each laundromat that uses DobiMaster is run by its own owner. When you report a problem at a shop, that shop’s owner and staff see your report so they can fix the machine or refund you.',
        ],
      },
      {
        h: '2. No account needed',
        blocks: [
          'No sign-up, no name, no email. The first time you use the app, your phone gets a random ID that is stored on this phone only. That is how we remember your timers and reports.',
        ],
      },
      {
        h: '3. What we collect and why',
        blocks: [
          [
            'Timers you start (machine, shop, start and finish time): to show your countdown, alert you, and give the shop anonymous usage statistics (busy times).',
            'Notifications: if you turn them on, a push "address" from your browser, to send "almost done" alerts. They are delivered by your browser’s push service (Google, Apple or Mozilla).',
            'WhatsApp (if you link it): your WhatsApp number and the messages you send us, to send laundry alerts on WhatsApp.',
            'Problem reports: what went wrong, optional details and up to 3 photos; for refunds, your phone number. Photos are re-saved on your phone before upload, which removes location data.',
            '"Notify me when free": the machine size you are waiting for, to tell you when one frees up.',
            'Paying in the app (only at shops that offer it): amount, machine and result. Card or e-wallet details are entered on the payment provider’s page; we never see them.',
            'Technical: IP address and browser type in server logs, for security and to prevent abuse, kept for a short time.',
            'Your language choice, stored on your phone.',
          ],
        ],
      },
      {
        h: '4. Do I have to give it?',
        blocks: [
          'Everything is optional. Without notifications you won’t get alerts; without a phone number the shop can’t send you a refund. Coins and machines work without the app.',
        ],
      },
      {
        h: '5. Who we share it with',
        blocks: [
          [
            'The shop’s owner and staff: your reports and refund details; usage statistics without your identity.',
            `Service providers acting for us: server hosting (${i.dataLocation}), browser push services, WhatsApp (Meta) if you link it, the payment provider if you pay in the app.`,
            'Authorities, if the law requires it.',
          ],
          'We don’t sell your data and don’t use advertising or tracking cookies.',
        ],
      },
      {
        h: '6. Storage outside Malaysia',
        blocks: [
          `Our servers are in ${i.dataLocation}. Data is transferred there to run the service, with safeguards: encrypted connections (HTTPS) and access limited to authorised people.`,
        ],
      },
      {
        h: '7. How long we keep it',
        blocks: [
          [
            `Refund phone numbers: deleted ${r.contactPhoneDays} days after the report is closed.`,
            `Report photos: deleted ${r.ticketPhotoDays} days after the report is closed.`,
            `WhatsApp: your number is deleted after ${r.waContactDays} days without a message from you; the message log is kept ${r.waMessageDays} days.`,
            'Timers and payments: kept as the shop’s business records; once you delete your data they are no longer linked to you.',
          ],
        ],
      },
      {
        h: '8. Your choices and rights',
        blocks: [
          [
            'Delete my data: My laundry → "Delete my data on this phone". This removes your ID, alerts, WhatsApp link and reminders immediately. Open problem reports keep your phone number until they are resolved, so the shop can still refund you.',
            'Stop alerts any time: turn off notifications in your browser, or reply STOP on WhatsApp.',
            `Access or correction: email ${email(i)}. We will reply within 21 days.`,
            'Complaints: you can also contact the Personal Data Protection Commissioner (Jabatan Perlindungan Data Peribadi).',
          ],
        ],
      },
      {
        h: '9. Security',
        blocks: [
          'All connections are encrypted (HTTPS). Photos and phone numbers are visible only to the staff of the shop concerned. Passwords are stored in a form that can’t be read back. Data is backed up every night.',
        ],
      },
      {
        h: '10. Shop owners and staff',
        blocks: [
          'If you use the owner dashboard, we keep your name, email, password (in a form that can’t be read back), the devices you are signed in on (browser type, IP address, last used), the actions you take (an audit log, for accountability), checklist photos, and your WhatsApp number if linked. We use them to run your account and send the weekly summary, and keep them while your account is active.',
        ],
      },
      { h: '11. Changes', blocks: ['If this notice changes, we will update the date above and tell you about important changes in the app.'] },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Terms of use

export function termsOfUse(locale: LegalLocale, i: LegalInfo): LegalDoc {
  if (locale === 'ms')
    return {
      title: 'Terma penggunaan',
      intro: [`DobiMaster dikendalikan oleh ${identity(i)}. Dengan menggunakannya, anda bersetuju dengan terma ini. Hubungi kami: ${email(i)}.`],
      sections: [
        ...customerTermsMs(),
        ...ownerTermsMs(),
        { h: 'Undang-undang', blocks: ['Terma ini tertakluk kepada undang-undang Malaysia. Tiada apa-apa dalam terma ini mengehadkan hak anda di bawah Akta Perlindungan Pengguna 1999 yang tidak boleh dikecualikan.'] },
      ],
    };
  if (locale === 'zh')
    return {
      title: '使用条款',
      intro: [`DobiMaster 由 ${identity(i)} 运营。使用即表示您同意以下条款。联系我们：${email(i)}。`],
      sections: [
        ...customerTermsZh(),
        { h: '店主条款', blocks: ['店主条款目前提供英文和马来文版本（请在页面顶部切换语言）。'] },
        { h: '适用法律', blocks: ['本条款受马来西亚法律管辖。本条款不限制您依据《1999年消费者保护法》享有且不可排除的权利。'] },
      ],
    };
  return {
    title: 'Terms of use',
    intro: [`DobiMaster is operated by ${identity(i)}. By using it you agree to these terms. Contact us: ${email(i)}.`],
    sections: [
      ...customerTermsEn(),
      ...ownerTermsEn(),
      { h: 'Law', blocks: ['These terms are governed by the laws of Malaysia. Nothing in them limits your rights under the Consumer Protection Act 1999 that cannot be excluded.'] },
    ],
  };
}

function customerTermsEn(): Section[] {
  return [
    {
      h: 'For customers',
      blocks: [
        [
          'What DobiMaster is: a tool laundromats use to show machine status, run timers and alerts, and take problem reports. The shop, not DobiMaster, runs the machines, sets prices and shop rules, and decides refunds (except the automatic refund described below).',
          'Status and timers are estimates. "From check-ins" status can be out of date and sensors can fail. Check the machine before relying on it.',
          'Your laundry is your responsibility. Follow the shop’s rules, for example collecting on time. We are not responsible for loss of or damage to items.',
          'Reports and photos must be honest. Don’t photograph other people, and don’t post abusive content. We may remove reports that break this.',
          'Paying in the app (where offered) is processed by a licensed payment provider. A start only counts once the machine is detected running; if it isn’t, you are refunded in full automatically to the original payment method. Other refund requests are decided by the shop.',
          'DobiMaster is free for customers. It may sometimes be unavailable, and features may change. The shop works without it: coins still work.',
        ],
      ],
    },
  ];
}

function ownerTermsEn(): Section[] {
  return [
    {
      h: 'For shop owners',
      blocks: [
        [
          'Your account: give accurate details and keep your password secure. You are responsible for the staff you invite and what they do; remove staff who leave.',
          'Your shop: you are responsible for your machines, prices, shop rules, and handling customers’ complaints and refunds. Information you publish must be accurate.',
          'Customers’ data: you will see customers’ reports, photos and refund phone numbers. Use them only to deal with that report or refund. Don’t copy them elsewhere, use them for marketing, or share them. DobiMaster deletes them on the schedule in the privacy notice.',
          'Sensors and hardware: sensors only observe power use. Work inside an electrical distribution board must be done by a registered electrician. You are responsible for installation and for the safety of your machines and premises.',
          'Fees: the pilot is free. Any fees will be agreed with you in writing beforehand, with at least 30 days’ notice.',
          'The service: we work to keep it available and back up data every night, but we don’t guarantee uninterrupted service. Your shop must be able to run without it.',
          'Your data: your shop’s data is yours. You can ask for an export. When you close your account we delete it within 30 days, except what the law requires us to keep.',
          'Acceptable use: no unlawful use, no attempts to get around security or access other businesses’ data.',
          'Ending: you can close your account at any time. We may suspend an account for abuse or a security risk, and will tell you why.',
          'Liability: to the extent the law allows, our total liability to you is limited to the fees you paid us in the 12 months before the claim, and we are not liable for indirect losses such as lost revenue.',
        ],
      ],
    },
  ];
}

function customerTermsMs(): Section[] {
  return [
    {
      h: 'Untuk pelanggan',
      blocks: [
        [
          'Apa itu DobiMaster: alat yang digunakan oleh kedai dobi untuk menunjukkan status mesin, menjalankan pemasa dan amaran, dan menerima laporan masalah. Kedai, bukan DobiMaster, yang mengendalikan mesin, menetapkan harga dan peraturan kedai, dan memutuskan bayaran balik (kecuali bayaran balik automatik di bawah).',
          'Status dan pemasa adalah anggaran. Status "Daripada daftar masuk" mungkin tidak terkini dan sensor boleh rosak. Semak mesin sebelum bergantung padanya.',
          'Pakaian anda di bawah tanggungjawab anda. Ikut peraturan kedai, contohnya mengambil pakaian tepat pada masanya. Kami tidak bertanggungjawab atas kehilangan atau kerosakan barang.',
          'Laporan dan gambar mestilah jujur. Jangan ambil gambar orang lain dan jangan siarkan kandungan kesat. Kami boleh membuang laporan yang melanggar peraturan ini.',
          'Bayaran dalam aplikasi (jika ditawarkan) diproses oleh penyedia pembayaran berlesen. Mesin hanya dikira bermula apabila ia dikesan berjalan; jika tidak, anda dibayar balik sepenuhnya secara automatik ke kaedah pembayaran asal. Permintaan bayaran balik lain diputuskan oleh kedai.',
          'DobiMaster percuma untuk pelanggan. Ia mungkin kadangkala tidak tersedia, dan ciri boleh berubah. Kedai tetap beroperasi tanpanya: syiling masih berfungsi.',
        ],
      ],
    },
  ];
}

function ownerTermsMs(): Section[] {
  return [
    {
      h: 'Untuk pemilik kedai',
      blocks: [
        [
          'Akaun anda: berikan butiran yang tepat dan jaga kata laluan anda. Anda bertanggungjawab atas pekerja yang anda jemput dan tindakan mereka; buang akses pekerja yang berhenti.',
          'Kedai anda: anda bertanggungjawab atas mesin, harga, peraturan kedai, serta aduan dan bayaran balik pelanggan. Maklumat yang anda siarkan mestilah tepat.',
          'Data pelanggan: anda akan melihat laporan, gambar dan nombor telefon bayaran balik pelanggan. Gunakannya hanya untuk menguruskan laporan atau bayaran balik itu. Jangan salin ke tempat lain, gunakan untuk pemasaran, atau kongsikan. DobiMaster memadamnya mengikut jadual dalam notis privasi.',
          'Sensor dan perkakasan: sensor hanya memerhati penggunaan kuasa. Kerja di dalam papan agihan elektrik mesti dilakukan oleh pendawai elektrik berdaftar. Anda bertanggungjawab atas pemasangan dan keselamatan mesin serta premis anda.',
          'Yuran: perintis adalah percuma. Sebarang yuran akan dipersetujui secara bertulis terlebih dahulu, dengan notis sekurang-kurangnya 30 hari.',
          'Perkhidmatan: kami berusaha memastikannya sentiasa tersedia dan menyandarkan data setiap malam, tetapi tidak menjamin perkhidmatan tanpa gangguan. Kedai anda mesti boleh beroperasi tanpanya.',
          'Data anda: data kedai anda adalah milik anda. Anda boleh meminta salinan eksport. Apabila anda menutup akaun, kami memadamnya dalam masa 30 hari, kecuali yang dikehendaki undang-undang untuk disimpan.',
          'Penggunaan yang dibenarkan: tiada penggunaan yang menyalahi undang-undang, tiada percubaan memintas keselamatan atau mengakses data perniagaan lain.',
          'Penamatan: anda boleh menutup akaun bila-bila masa. Kami boleh menggantung akaun kerana penyalahgunaan atau risiko keselamatan, dan akan memberitahu sebabnya.',
          'Liabiliti: setakat yang dibenarkan undang-undang, jumlah liabiliti kami kepada anda terhad kepada yuran yang anda bayar kepada kami dalam 12 bulan sebelum tuntutan, dan kami tidak bertanggungjawab atas kerugian tidak langsung seperti kehilangan hasil.',
        ],
      ],
    },
  ];
}

function customerTermsZh(): Section[] {
  return [
    {
      h: '顾客条款',
      blocks: [
        [
          'DobiMaster 是什么：洗衣店用来显示机器状态、计时提醒和接收问题报告的工具。机器由店铺经营，价格、店规和退款也由店铺决定（以下所述的自动退款除外），而非 DobiMaster。',
          '状态和计时仅为估计。“来自签到”的状态可能不是最新的，传感器也可能失灵。请先查看机器再作依赖。',
          '您的衣物由您自己负责。请遵守店规，例如按时取衣。我们不对物品的遗失或损坏负责。',
          '报告和照片必须属实。请勿拍摄他人，也不要发布辱骂内容。违反者的报告可能会被删除。',
          '应用内付款（如有提供）由持牌支付服务商处理。只有检测到机器开始运转才算启动；否则会自动全额退回原付款方式。其他退款申请由店铺决定。',
          'DobiMaster 对顾客免费。服务有时可能无法使用，功能也可能变更。没有它店铺照常营业：投币依然可用。',
        ],
      ],
    },
  ];
}
