use crate::models::*;

fn reflect_8(mut data: u8) -> u8 {
    let mut result = 0u8;
    for _ in 0..8 {
        result = (result << 1) | (data & 1);
        data >>= 1;
    }
    result
}

fn reflect_16(mut data: u16) -> u16 {
    let mut result = 0u16;
    for _ in 0..16 {
        result = (result << 1) | (data & 1);
        data >>= 1;
    }
    result
}

fn reflect_32(mut data: u32) -> u32 {
    let mut result = 0u32;
    for _ in 0..32 {
        result = (result << 1) | (data & 1);
        data >>= 1;
    }
    result
}

pub fn calc_crc8(
    data: &[u8],
    polynomial: u8,
    initial_value: u8,
    input_reflected: bool,
    output_reflected: bool,
    final_xor: u8,
) -> u8 {
    let mut crc = initial_value;

    for &byte in data {
        let mut b = if input_reflected { reflect_8(byte) } else { byte };
        crc ^= b;
        for _ in 0..8 {
            if crc & 0x80 != 0 {
                crc = (crc << 1) ^ polynomial;
            } else {
                crc <<= 1;
            }
        }
    }

    if output_reflected {
        crc = reflect_8(crc);
    }

    crc ^ final_xor
}

pub fn calc_crc16_modbus(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            if crc & 0x0001 != 0 {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}

pub fn calc_crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    let polynomial: u16 = 0x1021;

    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ polynomial;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

pub fn calc_crc16_generic(
    data: &[u8],
    polynomial: u16,
    initial_value: u16,
    input_reflected: bool,
    output_reflected: bool,
    final_xor: u16,
) -> u16 {
    let mut crc = initial_value;

    for &byte in data {
        let mut b = if input_reflected { reflect_8(byte) as u16 } else { byte as u16 };
        crc ^= b << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ polynomial;
            } else {
                crc <<= 1;
            }
        }
    }

    if output_reflected {
        crc = reflect_16(crc);
    }

    crc ^ final_xor
}

pub fn calc_crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    crc ^ 0xFFFFFFFF
}

pub fn calc_lrc(data: &[u8]) -> u8 {
    let mut lrc: u8 = 0;
    for &byte in data {
        lrc = lrc.wrapping_add(byte);
    }
    (!lrc).wrapping_add(1)
}

pub fn calc_bcc(data: &[u8]) -> u8 {
    let mut bcc: u8 = 0;
    for &byte in data {
        bcc ^= byte;
    }
    bcc
}

pub fn calc_checksum8(data: &[u8]) -> u8 {
    let mut sum: u32 = 0;
    for &byte in data {
        sum += byte as u32;
    }
    (sum & 0xFF) as u8
}

pub fn calculate_checksum(
    data: &[u8],
    algorithm: &ChecksumAlgorithm,
) -> ChecksumResult {
    match algorithm {
        ChecksumAlgorithm::CRC8 {
            polynomial,
            initial_value,
            input_reflected,
            output_reflected,
            final_xor,
        } => {
            let value = calc_crc8(data, *polynomial, *initial_value, *input_reflected, *output_reflected, *final_xor);
            ChecksumResult {
                algorithm: "CRC8".to_string(),
                value: value as u64,
                hex: format!("{:02X}", value),
                bytes: vec![value],
            }
        }
        ChecksumAlgorithm::CRC16Modbus => {
            let value = calc_crc16_modbus(data);
            ChecksumResult {
                algorithm: "CRC16-Modbus".to_string(),
                value: value as u64,
                hex: format!("{:04X}", value),
                bytes: vec![(value & 0xFF) as u8, ((value >> 8) & 0xFF) as u8],
            }
        }
        ChecksumAlgorithm::CRC16CCITT => {
            let value = calc_crc16_ccitt(data);
            ChecksumResult {
                algorithm: "CRC16-CCITT".to_string(),
                value: value as u64,
                hex: format!("{:04X}", value),
                bytes: vec![((value >> 8) & 0xFF) as u8, (value & 0xFF) as u8],
            }
        }
        ChecksumAlgorithm::CRC32 => {
            let value = calc_crc32(data);
            ChecksumResult {
                algorithm: "CRC32".to_string(),
                value: value as u64,
                hex: format!("{:08X}", value),
                bytes: vec![
                    ((value >> 24) & 0xFF) as u8,
                    ((value >> 16) & 0xFF) as u8,
                    ((value >> 8) & 0xFF) as u8,
                    (value & 0xFF) as u8,
                ],
            }
        }
        ChecksumAlgorithm::LRC => {
            let value = calc_lrc(data);
            ChecksumResult {
                algorithm: "LRC".to_string(),
                value: value as u64,
                hex: format!("{:02X}", value),
                bytes: vec![value],
            }
        }
        ChecksumAlgorithm::BCC => {
            let value = calc_bcc(data);
            ChecksumResult {
                algorithm: "BCC".to_string(),
                value: value as u64,
                hex: format!("{:02X}", value),
                bytes: vec![value],
            }
        }
        ChecksumAlgorithm::Checksum8 => {
            let value = calc_checksum8(data);
            ChecksumResult {
                algorithm: "Checksum".to_string(),
                value: value as u64,
                hex: format!("{:02X}", value),
                bytes: vec![value],
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc16_modbus() {
        let data = vec![0x01, 0x03, 0x00, 0x00, 0x00, 0x0A];
        let crc = calc_crc16_modbus(&data);
        assert_eq!(crc, 0xC5CD);
    }

    #[test]
    fn test_crc32() {
        let data = b"123456789";
        let crc = calc_crc32(data);
        assert_eq!(crc, 0xCBF43926);
    }

    #[test]
    fn test_lrc() {
        let data = b":01020304";
        let lrc = calc_lrc(data);
        assert_eq!(lrc, 0xEB);
    }

    #[test]
    fn test_bcc() {
        let data = vec![0xAA, 0x55, 0x01, 0x02];
        let bcc = calc_bcc(&data);
        assert_eq!(bcc, 0xF6);
    }

    #[test]
    fn test_checksum8() {
        let data = vec![0x01, 0x02, 0x03, 0x04, 0x05];
        let sum = calc_checksum8(&data);
        assert_eq!(sum, 0x0F);
    }
}
