/* global sauce Backbone */

const DAY = 86400 * 1000;
const L = sauce.locale;
const H = L.human;
const D = sauce.date;


class RangeRouter extends Backbone.Router {
    constructor(urn, pageTitle) {
        const routes = {
            [`${urn}/:athleteId/:period/:metric/:endDay`]: 'onNav',
            [`${urn}/:athleteId/:period/:metric`]: 'onNav',
            [`${urn}/:athleteId/all`]: 'onNavAll',
            [`${urn}/:athleteId`]: 'onNav',
            [urn]: 'onNav',
        };
        super({routes});
        this.urn = urn;
        this.pageTitle = pageTitle;
        this.filters = {};
    }

    onNavAll(athleteId) {
        return this.onNav(athleteId, null, null, null, true);
    }

    onNav(athleteId, period, metric, endDay, all) {
        const validMetric = D.CalendarRange.isValidMetric(metric);
        let suggestedEnd = validMetric && endDay ? new Date(D.addTZ(Number(endDay) * DAY)) : null;
        if (suggestedEnd && suggestedEnd >= Date.now()) {
            suggestedEnd = null;
        }
        this.filters = {
            athleteId: athleteId && Number(athleteId),
            period: validMetric && Number(period) ? Number(period) : null,
            metric: validMetric ? metric : null,
            suggestedEnd,
            all: validMetric && period ? false : all,
        };
    }

    setFilters(athlete, range, options={}) {
        const f = this.filters;
        f.athleteId = athlete ? athlete.id : null;
        if (range) {
            this.filters.period = range.period;
            this.filters.metric = range.metric;
            this.filters.suggestedEnd = range.end < Date.now() ? range.end : null;
        }
        if (options.all && f.athleteId != null) {
            this.navigate(`${this.urn}/${f.athleteId}/all`, options);
        } else if (f.suggestedEnd != null &&
            f.period != null &&
            f.metric != null &&
            f.athleteId != null) {
            const endDay = D.subtractTZ(f.suggestedEnd) / DAY;
            this.navigate(`${this.urn}/${f.athleteId}/${f.period}/${f.metric}/${endDay}`, options);
        } else if (f.period != null && f.metric != null && f.athleteId != null) {
            this.navigate(`${this.urn}/${f.athleteId}/${f.period}/${f.metric}`, options);
        } else if (f.athleteId != null) {
            this.navigate(`${this.urn}/${f.athleteId}`, options);
        } else {
            this.navigate(`${this.urn}`, options);
        }
        if (athlete) {
            const start = H.date(range.start);
            const end = H.date(D.roundToLocaleDayDate(range.end - DAY));
            document.title = `${athlete.name} | ${start} -> ${end} | ${this.pageTitle}`;
        } else {
            document.title = this.pageTitle;
        }
    }
}
export default RangeRouter;
