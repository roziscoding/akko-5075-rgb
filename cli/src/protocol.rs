//! RongYuan vendor protocol as spoken by the Akko 5075. See the repository
//! README (sections 3 to 5) for the wire format and the per-zone quirks.

use std::fmt;
use std::str::FromStr;

pub const VID: u16 = 0x3151;
pub const PID: u16 = 0x5002;
pub const VENDOR_USAGE_PAGE: u16 = 0xFFFF;
pub const VENDOR_INTERFACE: i32 = 2;

/// 64 data bytes plus the report id that Linux expects in front of them.
pub const WIRE_LEN: usize = 65;

pub const MAX_LEVEL: u8 = 4;

const SIDE_MAX_MODE: u8 = 5;
const RIPPLE_MODE: u8 = 5;

const OPT_RAINBOW: u8 = 0x07;
const OPT_RGB: u8 = 0x08;
const OPT_SOURCE_MASK: u8 = 0x0F;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Zone {
    Keys,
    Side,
}

impl Zone {
    fn set_cmd(self) -> u8 {
        match self {
            Zone::Keys => 0x07,
            Zone::Side => 0x08,
        }
    }

    fn get_cmd(self) -> u8 {
        match self {
            Zone::Keys => 0x87,
            Zone::Side => 0x88,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Zone::Keys => "keys",
            Zone::Side => "side",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Effect {
    pub name: &'static str,
    pub value: u8,
}

/// User Picture (13) and Per-Key Color (25) are not writable on stock firmware.
/// The music and screen modes (20 to 22) need the vendor driver feeding them.
pub const EFFECTS: &[Effect] = &[
    Effect {
        name: "off",
        value: 0,
    },
    Effect {
        name: "constant",
        value: 1,
    },
    Effect {
        name: "breathing",
        value: 2,
    },
    Effect {
        name: "neon",
        value: 3,
    },
    Effect {
        name: "wave",
        value: 4,
    },
    Effect {
        name: "ripple",
        value: 5,
    },
    Effect {
        name: "raindrop",
        value: 6,
    },
    Effect {
        name: "snake",
        value: 7,
    },
    Effect {
        name: "reactive",
        value: 8,
    },
    Effect {
        name: "converge",
        value: 9,
    },
    Effect {
        name: "sine-wave",
        value: 10,
    },
    Effect {
        name: "kaleidoscope",
        value: 11,
    },
    Effect {
        name: "line-wave",
        value: 12,
    },
    Effect {
        name: "laser",
        value: 14,
    },
    Effect {
        name: "circle-wave",
        value: 15,
    },
    Effect {
        name: "rainbow",
        value: 16,
    },
    Effect {
        name: "rain-down",
        value: 17,
    },
    Effect {
        name: "meteor",
        value: 18,
    },
    Effect {
        name: "reactive-off",
        value: 19,
    },
    Effect {
        name: "train",
        value: 23,
    },
    Effect {
        name: "fireworks",
        value: 24,
    },
];

pub fn effect_by_name(name: &str) -> Result<&'static Effect, String> {
    let wanted = name.trim().to_lowercase().replace([' ', '_'], "-");

    EFFECTS
        .iter()
        .find(|effect| effect.name == wanted)
        .ok_or_else(|| format!("unknown effect '{name}', run `akko-rgb effects` to list them"))
}

pub fn effect_label(value: u8) -> String {
    EFFECTS
        .iter()
        .find(|effect| effect.value == value)
        .map_or_else(|| format!("mode {value}"), |effect| effect.name.to_string())
}

pub fn side_supports(effect: &Effect) -> bool {
    effect.value <= SIDE_MAX_MODE
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl FromStr for Rgb {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let hex = value.trim().trim_start_matches('#');
        let invalid = || format!("invalid color '{value}', expected RRGGBB");

        if hex.len() != 6 || !hex.is_ascii() {
            return Err(invalid());
        }

        let channel = |range| u8::from_str_radix(&hex[range], 16).map_err(|_| invalid());

        Ok(Rgb {
            r: channel(0..2)?,
            g: channel(2..4)?,
            b: channel(4..6)?,
        })
    }
}

impl fmt::Display for Rgb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorChange {
    Rgb(Rgb),
    Rainbow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LedParam {
    pub mode: u8,
    pub speed: u8,
    pub brightness: u8,
    pub options: u8,
    pub color: Rgb,
}

impl LedParam {
    /// Used when the keyboard does not answer a read.
    pub const FALLBACK: LedParam = LedParam {
        mode: 1,
        speed: 2,
        brightness: MAX_LEVEL,
        options: OPT_RGB,
        color: Rgb {
            r: 255,
            g: 255,
            b: 255,
        },
    };

    pub fn source_label(&self) -> String {
        match self.options & OPT_SOURCE_MASK {
            OPT_RGB => self.color.to_string(),
            OPT_RAINBOW => "rainbow".to_string(),
            palette => format!("palette {palette}"),
        }
    }

    /// Speed on the 0-4 scale where 4 is always the fastest.
    pub fn ui_speed(&self, zone: Zone) -> u8 {
        speed_byte(zone, self.speed)
    }
}

/// The keys store speed inverted (4 is slowest), the side bars do not. The
/// conversion is its own inverse, so it serves both directions.
fn speed_byte(zone: Zone, speed: u8) -> u8 {
    match zone {
        Zone::Keys => MAX_LEVEL.saturating_sub(speed),
        Zone::Side => speed,
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Changes {
    pub effect: Option<&'static Effect>,
    pub color: Option<ColorChange>,
    pub speed: Option<u8>,
    pub brightness: Option<u8>,
}

/// Applies `changes` over the zone's `current` parameters. Returns `None` when
/// the zone cannot run the resulting effect.
pub fn apply(zone: Zone, current: LedParam, changes: &Changes) -> Option<LedParam> {
    let mut next = current;

    if let Some(effect) = changes.effect {
        next.mode = effect.value;
    }

    if zone == Zone::Side && next.mode > SIDE_MAX_MODE {
        return None;
    }

    match changes.color {
        Some(ColorChange::Rgb(color)) => {
            next.color = color;
            next.options = with_source(next.options, OPT_RGB);
        }
        Some(ColorChange::Rainbow) => next.options = with_source(next.options, OPT_RAINBOW),
        None => {}
    }

    if let Some(speed) = changes.speed {
        next.speed = speed_byte(zone, speed);
    }

    if let Some(brightness) = changes.brightness {
        next.brightness = brightness;
    }

    // The side bars only animate Ripple with the rainbow source.
    if zone == Zone::Side && next.mode == RIPPLE_MODE {
        next.options = with_source(next.options, OPT_RAINBOW);
    }

    Some(next)
}

fn with_source(options: u8, source: u8) -> u8 {
    (options & !OPT_SOURCE_MASK) | source
}

fn write_checksum(data: &mut [u8], at: usize) {
    let sum = data[..at]
        .iter()
        .fold(0u8, |sum, byte| sum.wrapping_add(*byte));
    data[at] = 255 - sum;
}

pub fn set_frame(zone: Zone, param: &LedParam) -> [u8; WIRE_LEN] {
    let mut wire = [0u8; WIRE_LEN];
    let data = &mut wire[1..];

    data[..8].copy_from_slice(&[
        zone.set_cmd(),
        param.mode,
        param.speed,
        param.brightness,
        param.options,
        param.color.r,
        param.color.g,
        param.color.b,
    ]);
    write_checksum(data, 8);

    wire
}

pub fn get_frame(zone: Zone) -> [u8; WIRE_LEN] {
    let mut wire = [0u8; WIRE_LEN];
    let data = &mut wire[1..];

    data[0] = zone.get_cmd();
    write_checksum(data, 7);

    wire
}

/// The report id may or may not lead the response, so this looks for the
/// echoed command in both positions.
pub fn parse_response(zone: Zone, raw: &[u8]) -> Option<LedParam> {
    let cmd = zone.get_cmd();
    let body = match raw {
        [0, echoed, ..] if *echoed == cmd => &raw[1..],
        [echoed, ..] if *echoed == cmd => raw,
        _ => return None,
    };

    let [_, mode, speed, brightness, options, r, g, b, ..] = *body else {
        return None;
    };

    Some(LedParam {
        mode,
        speed,
        brightness,
        options,
        color: Rgb { r, g, b },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgb = Rgb { r: 255, g: 0, b: 0 };

    fn effect(name: &str) -> &'static Effect {
        effect_by_name(name).unwrap()
    }

    fn param(mode: u8, speed: u8, options: u8) -> LedParam {
        LedParam {
            mode,
            speed,
            brightness: 3,
            options,
            color: Rgb { r: 1, g: 2, b: 3 },
        }
    }

    #[test]
    fn set_frame_has_report_id_and_bit8_checksum() {
        let frame = set_frame(
            Zone::Keys,
            &LedParam {
                mode: 1,
                speed: 0,
                brightness: 4,
                options: 0x08,
                color: RED,
            },
        );

        assert_eq!(frame[..10], [0, 0x07, 1, 0, 4, 0x08, 255, 0, 0, 0xEC]);
        assert_eq!(frame.len(), 65);
    }

    #[test]
    fn get_frame_has_bit7_checksum() {
        assert_eq!(
            get_frame(Zone::Keys)[..9],
            [0, 0x87, 0, 0, 0, 0, 0, 0, 0x78]
        );
        assert_eq!(
            get_frame(Zone::Side)[..9],
            [0, 0x88, 0, 0, 0, 0, 0, 0, 0x77]
        );
    }

    #[test]
    fn parses_response_with_and_without_report_id() {
        let body = [0x87, 4, 1, 3, 0x08, 10, 20, 30];
        let expected = Some(LedParam {
            mode: 4,
            speed: 1,
            brightness: 3,
            options: 0x08,
            color: Rgb {
                r: 10,
                g: 20,
                b: 30,
            },
        });

        assert_eq!(parse_response(Zone::Keys, &body), expected);

        let mut prefixed = vec![0];
        prefixed.extend_from_slice(&body);
        assert_eq!(parse_response(Zone::Keys, &prefixed), expected);
    }

    #[test]
    fn rejects_response_for_another_command() {
        assert_eq!(
            parse_response(Zone::Side, &[0x87, 4, 1, 3, 8, 10, 20, 30]),
            None
        );
        assert_eq!(parse_response(Zone::Keys, &[0x87, 4]), None);
    }

    #[test]
    fn speed_is_inverted_only_on_the_keys() {
        let changes = Changes {
            speed: Some(4),
            ..Changes::default()
        };

        assert_eq!(
            apply(Zone::Keys, param(4, 2, 8), &changes).unwrap().speed,
            0
        );
        assert_eq!(
            apply(Zone::Side, param(4, 2, 8), &changes).unwrap().speed,
            4
        );
        assert_eq!(param(4, 0, 8).ui_speed(Zone::Keys), 4);
        assert_eq!(param(4, 0, 8).ui_speed(Zone::Side), 0);
    }

    #[test]
    fn unspecified_fields_are_kept() {
        let current = param(4, 1, 0x08);
        let changes = Changes {
            color: Some(ColorChange::Rgb(RED)),
            ..Changes::default()
        };

        let next = apply(Zone::Keys, current, &changes).unwrap();

        assert_eq!(next.color, RED);
        assert_eq!((next.mode, next.speed, next.brightness), (4, 1, 3));
    }

    #[test]
    fn color_changes_only_the_source_nibble() {
        let changes = Changes {
            color: Some(ColorChange::Rainbow),
            ..Changes::default()
        };
        assert_eq!(
            apply(Zone::Keys, param(4, 1, 0x38), &changes)
                .unwrap()
                .options,
            0x37
        );

        let changes = Changes {
            color: Some(ColorChange::Rgb(RED)),
            ..Changes::default()
        };
        assert_eq!(
            apply(Zone::Keys, param(4, 1, 0x03), &changes)
                .unwrap()
                .options,
            0x08
        );
    }

    #[test]
    fn side_bars_refuse_effects_above_ripple() {
        let changes = Changes {
            effect: Some(effect("snake")),
            ..Changes::default()
        };

        assert_eq!(apply(Zone::Side, param(1, 0, 8), &changes), None);
        assert!(apply(Zone::Keys, param(1, 0, 8), &changes).is_some());
        assert!(!side_supports(effect("snake")));
        assert!(side_supports(effect("ripple")));
    }

    #[test]
    fn side_ripple_forces_rainbow() {
        let changes = Changes {
            effect: Some(effect("ripple")),
            color: Some(ColorChange::Rgb(RED)),
            ..Changes::default()
        };

        assert_eq!(
            apply(Zone::Side, param(1, 0, 8), &changes).unwrap().options,
            0x07
        );
        assert_eq!(
            apply(Zone::Keys, param(1, 0, 8), &changes).unwrap().options,
            0x08
        );
    }

    #[test]
    fn parses_colors() {
        assert_eq!("ff0000".parse::<Rgb>(), Ok(RED));
        assert_eq!("#FF0000\n".parse::<Rgb>(), Ok(RED));
        assert!("ff00".parse::<Rgb>().is_err());
        assert!("gg0000".parse::<Rgb>().is_err());
        assert!("ééé".parse::<Rgb>().is_err());
    }

    #[test]
    fn finds_effects_by_loose_name() {
        assert_eq!(effect("Sine Wave").value, 10);
        assert_eq!(effect("sine_wave").value, 10);
        assert!(effect_by_name("user-picture").is_err());
    }
}
