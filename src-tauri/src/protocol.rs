use crate::checksums::*;
use crate::models::*;
use uuid::Uuid;

const FIELD_COLORS: &[&str] = &[
    "#4a9eff20", "#4ade8020", "#fbbf2420", "#a78bfa20",
    "#fb923c20", "#22d3ee20", "#f472b620", "#38bdf820",
    "#facc1520", "#86efac20", "#c084fc20", "#f8717120",
];

pub fn get_builtin_protocols() -> Vec<ProtocolTemplate> {
    vec![
        create_modbus_rtu_template(),
        create_simple_binary_template(),
        create_at_command_template(),
    ]
}

fn create_modbus_rtu_template() -> ProtocolTemplate {
    ProtocolTemplate {
        id: Uuid::nil(),
        name: "Modbus RTU".to_string(),
        description: Some("Modbus RTU standard protocol (Address + Function + Data + CRC16)".to_string()),
        is_builtin: true,
        frame_delimiter: None,
        fields: vec![
            FieldDefinition {
                name: "地址".to_string(),
                field_type: FieldType::UInt8,
                byte_length: Some(1),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("从机地址 (1-247)".to_string()),
            },
            FieldDefinition {
                name: "功能码".to_string(),
                field_type: FieldType::UInt8,
                byte_length: Some(1),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("Modbus功能码".to_string()),
            },
            FieldDefinition {
                name: "数据长度".to_string(),
                field_type: FieldType::Length,
                byte_length: Some(1),
                length_ref_field: None,
                display_format: DisplayFormat::Decimal,
                fixed_value: None,
                description: Some("后续数据域字节数".to_string()),
            },
            FieldDefinition {
                name: "数据".to_string(),
                field_type: FieldType::RawBytes,
                byte_length: None,
                length_ref_field: Some("数据长度".to_string()),
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("数据域内容".to_string()),
            },
            FieldDefinition {
                name: "CRC16".to_string(),
                field_type: FieldType::Checksum,
                byte_length: Some(2),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("CRC16-Modbus校验 (Little-Endian)".to_string()),
            },
        ],
    }
}

fn create_simple_binary_template() -> ProtocolTemplate {
    ProtocolTemplate {
        id: Uuid::nil(),
        name: "简单二进制帧".to_string(),
        description: Some("自定义二进制协议 (帧头0xAA55 + 长度 + 命令 + 数据 + 校验 + 帧尾0x55AA)".to_string()),
        is_builtin: true,
        frame_delimiter: None,
        fields: vec![
            FieldDefinition {
                name: "帧头".to_string(),
                field_type: FieldType::FrameHeader,
                byte_length: Some(2),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: Some(vec![0xAA, 0x55]),
                description: Some("帧同步标志 0xAA55".to_string()),
            },
            FieldDefinition {
                name: "数据长度".to_string(),
                field_type: FieldType::Length,
                byte_length: Some(1),
                length_ref_field: None,
                display_format: DisplayFormat::Decimal,
                fixed_value: None,
                description: Some("命令码+数据域总字节数".to_string()),
            },
            FieldDefinition {
                name: "命令码".to_string(),
                field_type: FieldType::UInt8,
                byte_length: Some(1),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("命令标识符".to_string()),
            },
            FieldDefinition {
                name: "数据".to_string(),
                field_type: FieldType::RawBytes,
                byte_length: None,
                length_ref_field: Some("数据长度".to_string()),
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("数据域内容 (长度=数据长度-1)".to_string()),
            },
            FieldDefinition {
                name: "校验和".to_string(),
                field_type: FieldType::Checksum,
                byte_length: Some(1),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: None,
                description: Some("BCC异或校验 (命令码+数据)".to_string()),
            },
            FieldDefinition {
                name: "帧尾".to_string(),
                field_type: FieldType::FrameHeader,
                byte_length: Some(2),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: Some(vec![0x55, 0xAA]),
                description: Some("帧结束标志 0x55AA".to_string()),
            },
        ],
    }
}

fn create_at_command_template() -> ProtocolTemplate {
    ProtocolTemplate {
        id: Uuid::nil(),
        name: "AT指令集".to_string(),
        description: Some("AT文本命令 (以AT开头, \\r\\n结尾)".to_string()),
        is_builtin: true,
        frame_delimiter: Some(vec![0x0D, 0x0A]),
        fields: vec![
            FieldDefinition {
                name: "前缀".to_string(),
                field_type: FieldType::FrameHeader,
                byte_length: Some(2),
                length_ref_field: None,
                display_format: DisplayFormat::Ascii,
                fixed_value: Some(vec![b'A', b'T']),
                description: Some("AT命令前缀".to_string()),
            },
            FieldDefinition {
                name: "命令内容".to_string(),
                field_type: FieldType::String,
                byte_length: None,
                length_ref_field: None,
                display_format: DisplayFormat::Ascii,
                fixed_value: None,
                description: Some("命令正文 (不含前缀和行尾)".to_string()),
            },
            FieldDefinition {
                name: "行尾".to_string(),
                field_type: FieldType::FrameHeader,
                byte_length: Some(2),
                length_ref_field: None,
                display_format: DisplayFormat::Hexadecimal,
                fixed_value: Some(vec![0x0D, 0x0A]),
                description: Some("回车换行符".to_string()),
            },
        ],
    }
}

fn find_sequence(data: &[u8], seq: &[u8]) -> Option<usize> {
    if seq.is_empty() || data.len() < seq.len() {
        return None;
    }
    for i in 0..=data.len() - seq.len() {
        if data[i..i + seq.len()] == *seq {
            return Some(i);
        }
    }
    None
}

fn get_frame_header_bytes(fields: &[FieldDefinition]) -> Option<Vec<u8>> {
    for field in fields {
        if matches!(field.field_type, FieldType::FrameHeader) {
            if let Some(fixed) = &field.fixed_value {
                return Some(fixed.clone());
            }
        }
    }
    None
}

fn parse_value_from_bytes(field: &FieldDefinition, data: &[u8]) -> (String, Vec<u8>) {
    let raw = data.to_vec();
    let value = match field.field_type {
        FieldType::UInt8 | FieldType::FrameHeader => {
            if data.len() >= 1 {
                match field.display_format {
                    DisplayFormat::Decimal => format!("{}", data[0]),
                    DisplayFormat::Hexadecimal => format!("0x{:02X}", data[0]),
                    DisplayFormat::Binary => format!("0b{:08b}", data[0]),
                    DisplayFormat::Ascii => {
                        if data[0] >= 0x20 && data[0] < 0x7F {
                            data[0] as char
                        } else {
                            '.'
                        }.to_string()
                    }
                }
            } else {
                "N/A".to_string()
            }
        }
        FieldType::UInt16BE => {
            if data.len() >= 2 {
                let v = u16::from_be_bytes([data[0], data[1]]);
                match field.display_format {
                    DisplayFormat::Decimal => format!("{}", v),
                    DisplayFormat::Hexadecimal => format!("0x{:04X}", v),
                    DisplayFormat::Binary => format!("0b{:016b}", v),
                    _ => format!("{}", v),
                }
            } else { "N/A".to_string() }
        }
        FieldType::UInt16LE | FieldType::Checksum => {
            if data.len() >= 2 {
                let v = u16::from_le_bytes([data[0], data[1]]);
                match field.display_format {
                    DisplayFormat::Decimal => format!("{}", v),
                    DisplayFormat::Hexadecimal => format!("0x{:04X}", v),
                    DisplayFormat::Binary => format!("0b{:016b}", v),
                    _ => format!("{}", v),
                }
            } else { "N/A".to_string() }
        }
        FieldType::UInt32BE => {
            if data.len() >= 4 {
                let v = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                match field.display_format {
                    DisplayFormat::Decimal => format!("{}", v),
                    DisplayFormat::Hexadecimal => format!("0x{:08X}", v),
                    _ => format!("{}", v),
                }
            } else { "N/A".to_string() }
        }
        FieldType::UInt32LE => {
            if data.len() >= 4 {
                let v = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                match field.display_format {
                    DisplayFormat::Decimal => format!("{}", v),
                    DisplayFormat::Hexadecimal => format!("0x{:08X}", v),
                    _ => format!("{}", v),
                }
            } else { "N/A".to_string() }
        }
        FieldType::Int8 => {
            if data.len() >= 1 {
                let v = data[0] as i8;
                match field.display_format {
                    DisplayFormat::Decimal => format!("{}", v),
                    DisplayFormat::Hexadecimal => format!("0x{:02X}", data[0]),
                    _ => format!("{}", v),
                }
            } else { "N/A".to_string() }
        }
        FieldType::Int16BE => {
            if data.len() >= 2 {
                let v = i16::from_be_bytes([data[0], data[1]]);
                format!("{}", v)
            } else { "N/A".to_string() }
        }
        FieldType::Int16LE => {
            if data.len() >= 2 {
                let v = i16::from_le_bytes([data[0], data[1]]);
                format!("{}", v)
            } else { "N/A".to_string() }
        }
        FieldType::Float32BE => {
            if data.len() >= 4 {
                let v = f32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                format!("{:.4}", v)
            } else { "N/A".to_string() }
        }
        FieldType::Float32LE => {
            if data.len() >= 4 {
                let v = f32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                format!("{:.4}", v)
            } else { "N/A".to_string() }
        }
        FieldType::Length => {
            if data.len() >= 1 {
                format!("{}", data[0])
            } else { "N/A".to_string() }
        }
        FieldType::String => {
            let s: String = data.iter()
                .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
                .collect();
            match field.display_format {
                DisplayFormat::Ascii => s,
                DisplayFormat::Hexadecimal => {
                    data.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
                }
                _ => s,
            }
        }
        FieldType::RawBytes => {
            match field.display_format {
                DisplayFormat::Hexadecimal => {
                    data.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
                }
                DisplayFormat::Ascii => {
                    data.iter()
                        .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
                        .collect()
                }
                DisplayFormat::Decimal => {
                    data.iter().map(|b| format!("{}", b)).collect::<Vec<_>>().join(" ")
                }
                _ => {
                    data.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
                }
            }
        }
    };
    (value, raw)
}

pub struct FrameParser {
    template: ProtocolTemplate,
    buffer: Vec<u8>,
    dropped_bytes: usize,
}

impl FrameParser {
    pub fn new(template: ProtocolTemplate) -> Self {
        Self {
            template,
            buffer: Vec::new(),
            dropped_bytes: 0,
        }
    }

    pub fn feed(&mut self, data: &[u8]) -> (Vec<ParsedFrame>, usize) {
        self.buffer.extend_from_slice(data);
        let mut frames = Vec::new();
        let mut total_dropped = 0;

        loop {
            let (frame, consumed, dropped) = self.try_parse_one();
            total_dropped += dropped;
            if let Some(f) = frame {
                frames.push(f);
            }
            if consumed == 0 && dropped == 0 {
                break;
            }
        }

        (frames, total_dropped)
    }

    fn try_parse_one(&mut self) -> (Option<ParsedFrame>, usize, usize) {
        let header = get_frame_header_bytes(&self.template.fields);
        let delimiter = &self.template.frame_delimiter.clone();

        let search_start = header.clone().or_else(|| delimiter.clone());

        if let Some(header_bytes) = &search_start {
            let pos = find_sequence(&self.buffer, header_bytes);
            match pos {
                Some(0) => {}
                Some(p) => {
                    let dropped = p;
                    self.buffer.drain(0..p);
                    return (None, 0, dropped);
                }
                None => {
                    let keep = self.buffer.len().saturating_sub(header_bytes.len() - 1);
                    let dropped = keep;
                    self.buffer.drain(0..keep);
                    return (None, 0, dropped);
                }
            }
        }

        let mut parsed_fields: Vec<ParsedField> = Vec::new();
        let mut offset: usize = 0;
        let mut dynamic_lengths: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut checksum_fields: Vec<(usize, usize)> = Vec::new();
        let mut checksum_algo_ranges: Vec<(usize, usize, usize)> = Vec::new();

        for (field_idx, field) in self.template.fields.iter().enumerate() {
            let byte_len = if let Some(len) = field.byte_length {
                len
            } else if let Some(ref_name) = &field.length_ref_field {
                *dynamic_lengths.get(ref_name).unwrap_or(&0)
            } else if matches!(field.field_type, FieldType::String) {
                if let Some(delim) = delimiter {
                    let search_from = offset;
                    if let Some(delim_pos) = find_sequence(&self.buffer[search_from..], delim) {
                        let total_str_len = self.template.fields.iter()
                            .enumerate()
                            .filter(|(i, f)| *i < field_idx && matches!(f.field_type, FieldType::String))
                            .count();
                        let actual_pos = search_from + delim_pos;
                        if actual_pos > offset {
                            actual_pos - offset
                        } else {
                            return (None, 0, 0);
                        }
                    } else {
                        return (None, 0, 0);
                    }
                } else {
                    let remaining = self.buffer.len().saturating_sub(offset);
                    if remaining > 0 { remaining } else { return (None, 0, 0); }
                }
            } else {
                return (None, 0, 0);
            };

            if offset + byte_len > self.buffer.len() {
                return (None, 0, 0);
            }

            let field_data = &self.buffer[offset..offset + byte_len];

            if let Some(fixed) = &field.fixed_value {
                if field_data != fixed.as_slice() {
                    self.buffer.drain(0..1);
                    return (None, 0, 1);
                }
            }

            let (parsed_value, raw_bytes) = parse_value_from_bytes(field, field_data);
            let color = FIELD_COLORS[field_idx % FIELD_COLORS.len()].to_string();

            if matches!(field.field_type, FieldType::Length) {
                let len_val = raw_bytes.first().copied().unwrap_or(0) as usize;
                dynamic_lengths.insert(field.name.clone(), len_val);
                if let Some((data_idx, data_field)) = self.template.fields.iter()
                    .enumerate()
                    .find(|(_, f)| f.length_ref_field.as_deref() == Some(field.name.as_str()))
                {
                    if matches!(data_field.field_type, FieldType::RawBytes) {
                        let adjusted = if field_idx + 2 <= data_idx {
                            let sum_skip: usize = self.template.fields[field_idx+1..data_idx]
                                .iter()
                                .filter_map(|f| f.byte_length)
                                .sum();
                            len_val.saturating_sub(sum_skip)
                        } else { len_val };
                        dynamic_lengths.insert(data_field.name.clone(), adjusted);
                    }
                }
            }

            if matches!(field.field_type, FieldType::Checksum) {
                checksum_fields.push((field_idx, offset));
                let checksum_start = parsed_fields.first()
                    .map(|f| f.offset)
                    .unwrap_or(0);
                let checksum_end = offset;
                checksum_algo_ranges.push((field_idx, checksum_start, checksum_end));
            }

            parsed_fields.push(ParsedField {
                name: field.name.clone(),
                field_type: field.field_type.clone(),
                raw_bytes,
                parsed_value,
                offset,
                length: byte_len,
                color,
            });

            offset += byte_len;
        }

        let frame_len = offset;
        let raw_frame: Vec<u8> = self.buffer[..frame_len].to_vec();

        let mut checksum_valid = true;
        let mut error_msg: Option<String> = None;

        for (algo_idx, (field_idx, cs_start, cs_end)) in checksum_algo_ranges.iter().enumerate() {
            if let Some(parsed_field) = parsed_fields.get(*field_idx) {
                let calc_data = &raw_frame[*cs_start..*cs_end];
                let expected = &parsed_field.raw_bytes;

                let template_field = &self.template.fields[*field_idx];
                let algo = match self.template.name.as_str() {
                    "Modbus RTU" => ChecksumAlgorithm::CRC16Modbus,
                    "简单二进制帧" => ChecksumAlgorithm::BCC,
                    _ => {
                        if expected.len() == 2 {
                            ChecksumAlgorithm::CRC16Modbus
                        } else if expected.len() == 4 {
                            ChecksumAlgorithm::CRC32
                        } else {
                            ChecksumAlgorithm::BCC
                        }
                    }
                };

                let result = calculate_checksum(calc_data, &algo);
                let calc_bytes = &result.bytes;

                let match_ok = if self.template.name == "Modbus RTU" {
                    calc_bytes == expected
                } else if self.template.name == "简单二进制帧" {
                    if let Some(bcc_data_start) = parsed_fields.iter()
                        .find(|f| f.name == "命令码")
                        .map(|f| f.offset)
                    {
                        let simple_data = &raw_frame[bcc_data_start..*cs_end];
                        let simple_result = calculate_checksum(simple_data, &ChecksumAlgorithm::BCC);
                        simple_result.bytes == *expected
                    } else {
                        calc_bytes == expected
                    }
                } else {
                    calc_bytes == expected
                };

                if !match_ok {
                    checksum_valid = false;
                    let hex_expected: String = expected.iter()
                        .map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
                    let hex_calc: String = calc_bytes.iter()
                        .map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
                    error_msg = Some(format!(
                        "CRC错误: 期望[{}] 计算[{}]",
                        hex_expected, hex_calc
                    ));
                    break;
                }
            }
        }

        self.buffer.drain(0..frame_len);

        let frame = ParsedFrame {
            frame_id: Uuid::new_v4(),
            timestamp: chrono::Local::now().timestamp_millis() as u64,
            raw_data: raw_frame,
            fields: parsed_fields,
            checksum_valid,
            error_message: error_msg,
            frame_length: frame_len,
        };

        (Some(frame), frame_len, 0)
    }
}

pub fn parse_single_frame(data: &[u8], template: &ProtocolTemplate) -> Option<ParsedFrame> {
    let mut parser = FrameParser::new(template.clone());
    let (frames, _) = parser.feed(data);
    frames.into_iter().next()
}
