/**
 * Template có sẵn khi cài mới (giá trị mặc định của storage.local.templates).
 * Chỉ dùng khi chưa có khoá `templates` — người dùng xoá/sửa thì không bị ghi đè.
 */
import type { Template } from './storage';

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'builtin-interview-accept',
    name: 'Phỏng vấn – Xác nhận tham gia',
    subject: 'Xác nhận tham gia phỏng vấn vị trí {{vị_trí}} – {{họ_tên}}',
    body: [
      '<p>Kính gửi anh/chị {{name}},</p>',
      '<p>Em xin chân thành cảm ơn anh/chị và {{công_ty}} đã dành thời gian xem xét hồ sơ và mời em tham gia phỏng vấn cho vị trí <b>{{vị_trí}}</b>.</p>',
      '<p>Em xin xác nhận sẽ tham gia buổi phỏng vấn theo thông tin sau:</p>',
      '<ul><li><b>Thời gian:</b> {{thời_gian}}</li><li><b>Hình thức / địa điểm:</b> {{địa_điểm}}</li></ul>',
      '<p>Nếu cần em chuẩn bị thêm tài liệu hoặc thông tin nào trước buổi phỏng vấn, anh/chị vui lòng cho em biết. Em rất mong được trao đổi thêm với anh/chị về công việc và về cách em có thể đóng góp cho đội ngũ.</p>',
      '<p>Trân trọng,<br>{{họ_tên}}<br>{{số_điện_thoại}}</p>',
    ].join(''),
  },
  {
    id: 'builtin-interview-reschedule',
    name: 'Phỏng vấn – Đề nghị đổi lịch',
    subject: 'Đề nghị điều chỉnh lịch phỏng vấn vị trí {{vị_trí}} – {{họ_tên}}',
    body: [
      '<p>Kính gửi anh/chị {{name}},</p>',
      '<p>Em xin cảm ơn anh/chị đã sắp xếp buổi phỏng vấn cho vị trí <b>{{vị_trí}}</b> tại {{công_ty}}.</p>',
      '<p>Rất tiếc, vào thời gian đã hẹn ({{thời_gian}}) em có việc đột xuất không thể sắp xếp được. Em rất mong được tham gia phỏng vấn và xin phép đề xuất một trong các khung giờ sau:</p>',
      '<ul><li>{{khung_giờ_1}}</li><li>{{khung_giờ_2}}</li></ul>',
      '<p>Nếu các khung giờ trên chưa phù hợp, em sẵn sàng điều chỉnh theo lịch của anh/chị. Em thành thật xin lỗi vì sự bất tiện này và cảm ơn anh/chị đã thông cảm.</p>',
      '<p>Trân trọng,<br>{{họ_tên}}<br>{{số_điện_thoại}}</p>',
    ].join(''),
  },
  {
    id: 'builtin-interview-decline',
    name: 'Phỏng vấn – Từ chối lời mời',
    subject: 'Phản hồi lời mời phỏng vấn vị trí {{vị_trí}} – {{họ_tên}}',
    body: [
      '<p>Kính gửi anh/chị {{name}},</p>',
      '<p>Em xin chân thành cảm ơn anh/chị và {{công_ty}} đã quan tâm đến hồ sơ của em và gửi lời mời phỏng vấn cho vị trí <b>{{vị_trí}}</b>.</p>',
      '<p>Sau khi cân nhắc kỹ, em xin phép không tiếp tục tham gia quá trình tuyển dụng lần này do {{lý_do}}. Em rất tiếc vì không thể tham gia và mong anh/chị thông cảm.</p>',
      '<p>Em đánh giá cao sự chuyên nghiệp của anh/chị trong quá trình trao đổi, và hy vọng sẽ có dịp hợp tác cùng {{công_ty}} trong tương lai.</p>',
      '<p>Chúc anh/chị và đội ngũ nhiều thành công.</p>',
      '<p>Trân trọng,<br>{{họ_tên}}<br>{{số_điện_thoại}}</p>',
    ].join(''),
  },
  {
    id: 'builtin-interview-thanks',
    name: 'Phỏng vấn – Cảm ơn sau buổi phỏng vấn',
    subject: 'Cảm ơn anh/chị về buổi phỏng vấn vị trí {{vị_trí}} – {{họ_tên}}',
    body: [
      '<p>Kính gửi anh/chị {{name}},</p>',
      '<p>Em xin cảm ơn anh/chị đã dành thời gian trao đổi với em trong buổi phỏng vấn vị trí <b>{{vị_trí}}</b> vào {{thời_gian}}.</p>',
      '<p>Qua buổi trao đổi, em hiểu rõ hơn về công việc cũng như định hướng của đội ngũ, đặc biệt là {{điểm_ấn_tượng}}. Điều đó càng khiến em mong muốn được đồng hành cùng {{công_ty}}.</p>',
      '<p>Nếu anh/chị cần thêm thông tin nào từ phía em, em luôn sẵn sàng bổ sung. Em mong sớm nhận được phản hồi từ anh/chị.</p>',
      '<p>Trân trọng,<br>{{họ_tên}}<br>{{số_điện_thoại}}</p>',
    ].join(''),
  },
  {
    id: 'builtin-interview-feedback',
    name: 'Phỏng vấn – Xin feedback sau phỏng vấn',
    subject: 'Xin ý kiến phản hồi sau buổi phỏng vấn vị trí {{vị_trí}} – {{họ_tên}}',
    body: [
      '<p>Kính gửi anh/chị {{name}},</p>',
      '<p>Em xin cảm ơn anh/chị đã tạo cơ hội cho em tham gia phỏng vấn vị trí <b>{{vị_trí}}</b> tại {{công_ty}} vào {{thời_gian}}.</p>',
      '<p>Em luôn mong muốn hoàn thiện bản thân, vì vậy nếu thuận tiện, em rất mong nhận được đôi lời nhận xét của anh/chị về buổi phỏng vấn, chẳng hạn:</p>',
      '<ul><li>Những điểm em đã thể hiện tốt;</li><li>Những kỹ năng hoặc kiến thức em nên cải thiện thêm;</li><li>Kết quả hoặc các bước tiếp theo của quá trình tuyển dụng (nếu có).</li></ul>',
      '<p>Dù kết quả thế nào, những góp ý của anh/chị sẽ rất có giá trị với em. Em xin cảm ơn anh/chị đã dành thời gian.</p>',
      '<p>Trân trọng,<br>{{họ_tên}}<br>{{số_điện_thoại}}</p>',
    ].join(''),
  },
];
