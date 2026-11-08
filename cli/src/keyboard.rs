use std::thread::sleep;
use std::time::Duration;

use anyhow::{Context, Result};
use hidapi::{HidApi, HidDevice};

use crate::protocol::{self, LedParam, Zone};

const READ_ATTEMPTS: usize = 4;
const READ_DELAY: Duration = Duration::from_millis(80);

pub struct Keyboard {
    device: HidDevice,
}

impl Keyboard {
    pub fn open() -> Result<Self> {
        let api = HidApi::new().context("failed to initialize HID access")?;

        let info = api
            .device_list()
            .find(|info| {
                info.vendor_id() == protocol::VID
                    && info.product_id() == protocol::PID
                    && info.usage_page() == protocol::VENDOR_USAGE_PAGE
                    && info.interface_number() == protocol::VENDOR_INTERFACE
            })
            .context("Akko 5075 not found, is it connected over USB?")?;

        let device = info.open_device(&api).context(
            "failed to open the keyboard, is the udev rule from this repository installed?",
        )?;

        Ok(Self { device })
    }

    /// Returns `None` when the keyboard does not answer.
    pub fn read(&self, zone: Zone) -> Result<Option<LedParam>> {
        self.device
            .send_feature_report(&protocol::get_frame(zone))
            .context("failed to request the current lighting")?;

        for _ in 0..READ_ATTEMPTS {
            sleep(READ_DELAY);

            let mut buffer = [0u8; protocol::WIRE_LEN];

            if let Ok(length) = self.device.get_feature_report(&mut buffer)
                && let Some(param) = protocol::parse_response(zone, &buffer[..length])
            {
                return Ok(Some(param));
            }
        }

        Ok(None)
    }

    pub fn write(&self, zone: Zone, param: &LedParam) -> Result<()> {
        self.device
            .send_feature_report(&protocol::set_frame(zone, param))
            .context("failed to update the lighting")
    }
}
