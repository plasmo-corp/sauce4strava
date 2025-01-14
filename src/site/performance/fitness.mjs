/* global sauce */

import * as views from './views.mjs';
import * as data from './data.mjs';
import * as charts from './charts.mjs';
import * as peaks from './peaks.mjs';


const DAY = 86400 * 1000;
const L = sauce.locale;
const H = L.human;
const D = sauce.date;


function humanKJ(kj, options={}) {
    let val, unit;
    if (kj >= 10000000) {
        val = H.number(kj / 1000000);
        unit = 'gJ';
    } else if (kj >= 100000) {
        val = H.number(kj / 1000);
        unit = 'mJ';
    } else {
        val = H.number(kj);
        unit = 'kJ';
    }
    if (options.html) {
        return `${val} <abbr class="unit">${unit}</abbr>`;
    } else {
        return `${val} ${unit}`;
    }
}


function humanWatts(watts, options={}) {
    watts = H.number(watts);
    if (options.html) {
        return `${watts} <abbr class="unit">w</abbr>`;
    } else {
        return `${watts} w`;
    }
}


function getAthleteWeightAt(athlete, ts) {
    return sauce.model.getAthleteHistoryValueAt(athlete.weightHistory, ts);
}


function getAthleteFTPAt(athlete, ts) {
    return sauce.model.getAthleteHistoryValueAt(athlete.ftpHistory, ts);
}


function roundNumber(n, prec) {
    return Number(n.toFixed(prec));
}


function roundAvg(arr, prec) {
    return roundNumber(sauce.data.avg(arr), prec);
}


export class TrainingChartView extends charts.ActivityTimeRangeChartView {
    static uuid = 'a6e7bb31-7860-4946-91e5-da4c82c0a3f4';
    static tpl = 'performance/fitness/training-load.html';
    static typeLocaleKey = 'performance_training_load_type';
    static nameLocaleKey = 'performance_training_load_name';
    static descLocaleKey = 'performance_training_load_desc';
    static localeKeys = [
        'predicted_tss', 'predicted_tss_tooltip', 'fitness', 'fatigue', 'form',
        ...super.localeKeys,
    ];

    async init(options) {
        await super.init(options);
        this.availableDatasets = {
            'ctl': {label: `CTL (${this.LM('fitness')})`},
            'atl': {label: `ATL (${this.LM('fatigue')})`},
            'tsb': {label: `TSB (${this.LM('form')})`},
        };
        this.setChartConfig({
            plugins: [charts.overUnderFillPlugin],
            options: {
                plugins: {
                    datalabels: {
                        display: ctx =>
                            !!(ctx.dataset.data[ctx.dataIndex] &&
                            ctx.dataset.data[ctx.dataIndex].showDataLabel === true),
                        formatter: (value, ctx) => {
                            const r = ctx.dataset.tooltipFormat(value.y);
                            return Array.isArray(r) ? r[0] : r;
                        },
                        backgroundColor: ctx => ctx.dataset.backgroundColor,
                        borderRadius: 2,
                        color: 'white',
                        padding: 4,
                        anchor: 'center',
                    },
                },
                scales: {
                    yAxes: [{
                        id: 'tss',
                        scaleLabel: {labelString: 'TSS'},
                        ticks: {min: 0, maxTicksLimit: 6},
                    }, {
                        id: 'tsb',
                        scaleLabel: {labelString: 'TSB', display: true},
                        ticks: {maxTicksLimit: 8},
                        position: 'right',
                        gridLines: {display: false},
                    }]
                },
                tooltips: {
                    intersect: false,
                    bucketsFormatter: this.bucketsTooltipFormatter.bind(this),
                    defaultIndex: chart => {
                        if (chart.data.datasets && chart.data.datasets.length) {
                            const data = chart.data.datasets[0].data;
                            if (data && data.length) {
                                const today = D.today();
                                for (let i = data.length - 1; i; i--) {
                                    if (data[i].x <= today) {
                                        return i;
                                    }
                                }
                            }
                        }
                        return -1;
                    }
                }
            }
        });
    }

    bucketsTooltipFormatter(buckets) {
        const day = buckets[0];
        let desc;
        if (day.future) {
            desc = `<i title="${this.LM('predicted_tss_tooltip')}">` +
                `${this.LM('predicted_tss')}</i>`;
        } else if (day.activities.length > 1) {
            desc = `<i>${day.activities.length} ${this.LM('activities')}</i>`;
        } else if (day.activities.length === 1) {
            desc = day.activities[0].name;
        }
        return `${desc ? desc + ' ' : ''}(${day.future ? '~' : ''}${H.number(day.tss)} TSS)`;
    }

    updateChart() {
        const daily = this.daily;
        const lineWidth = this.range.days > 366 ? 0.66 : this.range.days > 60 ? 1 : 1.25;
        const maxCTLIndex = sauce.data.max(daily.map(x => x.ctl), {index: true});
        const minTSBIndex = sauce.data.min(daily.map(x => x.ctl - x.atl), {index: true});
        let future = [];
        if (this.range.end >= Date.now() && daily.length) {
            const last = daily[daily.length - 1];
            const fDays = Math.floor(Math.min(this.range.days * 0.10, 62));
            const fStart = D.dayAfter(last.date);
            const fEnd = D.roundToLocaleDayDate(+fStart + fDays * DAY);
            const predictions = [];
            const tau = 1;
            const decay = 2;
            const tssSlope = (((last.atl / last.ctl) || 1) - 1) / tau;
            let tssPred = last.ctl;
            for (const [i, date] of Array.from(D.dayRange(fStart, fEnd)).entries()) {
                tssPred *= 1 + (tssSlope * (1 / (i * decay + 1)));
                predictions.push({ts: +date, tssOverride: tssPred});
            }
            future = data.activitiesByDay(predictions, fStart, fEnd, last.atl, last.ctl);
        }
        const buckets = daily.concat(future.map(x => (x.future = true, x)));
        const ifFuture = (yes, no) => ctx => buckets[ctx.p1DataIndex].future ? yes : no;
        const disabled = this.getPrefs('disabledDatasets', {});
        const datasets = [];
        if (!disabled.ctl) {
            datasets.push({
                id: 'ctl',
                label: `CTL (${this.LM('fitness')})`,
                yAxisID: 'tss',
                borderWidth: lineWidth,
                backgroundColor: '#4c89d0e0',
                borderColor: '#2c69b0f0',
                pointStyle: ctx => ctx.dataIndex === maxCTLIndex ? 'circle' : false,
                pointRadius: ctx => ctx.dataIndex === maxCTLIndex ? 2 : 0,
                tooltipFormat: x => Math.round(x).toLocaleString(),
                segment: {
                    borderColor: ifFuture('4c89d0d0'),
                    borderDash: ifFuture([3, 3], []),
                },
                data: buckets.map((b, i) => ({
                    b,
                    x: b.date,
                    y: b.ctl,
                    showDataLabel: i === maxCTLIndex,
                })),
            });
        }
        if (!disabled.atl) {
            datasets.push({
                id: 'atl',
                label: `ATL (${this.LM('fatigue')})`,
                yAxisID: 'tss',
                borderWidth: lineWidth,
                backgroundColor: '#ff3730e0',
                borderColor: '#f02720f0',
                tooltipFormat: x => Math.round(x).toLocaleString(),
                segment: {
                    borderColor: ifFuture('#ff4740d0'),
                    borderDash: ifFuture([3, 3]),
                },
                data: buckets.map(b => ({
                    b,
                    x: b.date,
                    y: b.atl,
                }))
            });
        }
        if (!disabled.tsb) {
            datasets.push({
                id: 'tsb',
                label: `TSB (${this.LM('form')})`,
                yAxisID: 'tsb',
                borderWidth: lineWidth,
                backgroundColor: '#bc714cc0',
                borderColor: '#0008',
                fill: true,
                overUnder: true,
                overBackgroundColorMax: '#7fe78a',
                overBackgroundColorMin: '#bfe58a22',
                underBackgroundColorMin: '#d9940422',
                underBackgroundColorMax: '#bc0000',
                overBackgroundMax: 50,
                underBackgroundMin: -50,
                pointStyle: ctx => ctx.dataIndex === minTSBIndex ? 'circle' : false,
                pointRadius: ctx => ctx.dataIndex === minTSBIndex ? 2 : 0,
                tooltipFormat: x => Math.round(x).toLocaleString(),
                segment: {
                    borderColor: ifFuture('#000a'),
                    borderDash: ifFuture([3, 3]),
                    overBackgroundColorMax: ifFuture('#afba'),
                    overBackgroundColorMin: ifFuture('#df82'),
                    underBackgroundColorMin: ifFuture('#f922'),
                    underBackgroundColorMax: ifFuture('#d22b'),
                },
                data: buckets.map((b, i) => ({
                    b,
                    x: b.date,
                    y: b.ctl - b.atl,
                    showDataLabel: i === minTSBIndex,
                }))
            });
        }
        this.chart.data.datasets = datasets;
        this.chart.update();
    }
}


export class ZoneTimeChartView extends charts.ActivityTimeRangeChartView {
    static uuid = 'bb297504-5d68-4f69-b055-5fbabac4651a';
    static tpl = 'performance/fitness/zonetime.html';
    static typeLocaleKey = 'performance_zonetime_type';
    static nameLocaleKey = 'performance_zonetime_name';
    static descLocaleKey = 'performance_zonetime_desc';
    static localeKeys = ['power_zones', ...super.localeKeys];

    async init(options) {
        await super.init(options);
        this.availableDatasets = {
            'power-z1': {label: `Z1`},
            'power-z2': {label: `Z2`},
            'power-z3': {label: `Z3`},
            'power-z4': {label: `Z4`},
            'power-z5': {label: `Z5`},
            'power-z6': {label: `Z6`},
            'power-z7': {label: `Z7`},
        };
        this.setChartConfig({
            type: 'bar',
            options: {
                plugins: {
                    datalabels: {
                        display: ctx => {
                            const meta = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.dataIndex];
                            if (meta._model.width < 28) {
                                return false;
                            }
                            const height = meta._model.base - meta._model.y;
                            return height > 20 ? 'auto' : false;
                        },
                        formatter: (value, ctx) =>
                            H.number(value.y / sauce.data.sum(ctx.dataset.data[ctx.dataIndex].b.powerZonesTime) * 100) + '%',
                        backgroundColor: ctx => ctx.dataset.backgroundColor,
                        borderRadius: 2,
                        color: x => [0, 1, 2].includes(x.datasetIndex) ? 'black' : 'white',
                        padding: {top: 2, bottom: 2, left: 4, right: 4},
                        font: {size: 10},
                    },
                },
                scales: {
                    xAxes: [{
                        stacked: true,
                        offset: true,
                    }],
                    yAxes: [{
                        id: 'time',
                        position: 'right',
                        ticks: {
                            min: 0,
                            suggestedMax: 1 * 3600,
                            stepSize: 3600,
                            maxTicksLimit: 7,
                            callback: v => H.duration(v, {maxPeriod: 3600, minPeriod: 3600}),
                        }
                    }]
                },
            }
        });
    }

    updateChart() {
        this.$('.metric-display').text(this.pageView.getMetricLocale(this.range.metric));
        const zones = [
            {id: 'power-z1', i: 0, h: 180, s: 10, l: 70},
            {id: 'power-z2', i: 1, h: 100, s: 65, l: 60},
            {id: 'power-z3', i: 2, h: 60, s: 70, l: 60},
            {id: 'power-z4', i: 3, h: 0, s: 70, l: 60},
            {id: 'power-z5', i: 4, h: 320, s: 70, l: 50},
            {id: 'power-z6', i: 5, h: 300, s: 70, l: 40},
            {id: 'power-z7', i: 6, h: 280, s: 70, l: 20},
        ];
        const disabled = this.getPrefs('disabledDatasets', {});
        this.chart.data.datasets = zones.filter(x => !disabled[x.id]).map(x => ({
            id: x.id,
            label: this.availableDatasets[x.id].label,
            backgroundColor: `hsla(${x.h}deg, ${x.s - 3}%, ${x.l + 2}%, 0.8)`,
            hoverBackgroundColor: `hsla(${x.h}deg, ${x.s + 3}%, ${x.l - 2}%, 0.9)`,
            borderColor: `hsla(${x.h}deg, ${x.s - 3}%, ${x.l - 10}%, 0.9)`,
            hoverBorderColor: `hsla(${x.h}deg, ${x.s + 3}%, ${x.l - 20}%, 0.9)`,
            borderWidth: 1,
            yAxisID: 'time',
            stack: 'power',
            tooltipFormat: x => H.duration(x, {maxPeriod: 3600, minPeriod: 3600, digits: 1, html: true}),
            data: this.metricData.map((b, i) => ({
                b,
                x: b.date,
                y: b.powerZonesTime[x.i] || 0
            })),
        }));
        this.chart.update();
    }
}


export class ActivityStatsChartView extends charts.ActivityTimeRangeChartView {
    static uuid = '1b087d9a-d6ad-4c95-98c7-0c4b565edd29';
    static tpl = 'performance/fitness/activity-stats.html';
    static typeLocaleKey = 'performance_activity_stats_type';
    static nameLocaleKey = 'performance_activity_stats_name';
    static descLocaleKey = 'performance_activity_stats_desc';
    static localeKeys = [
        'predicted', '/analysis_time', '/analysis_distance', '/analysis_energy',
        ...super.localeKeys
    ];

    get defaultPrefs() {
        return {
            ...super.defaultPrefs,
            disabledDatasets: {
                energy: true,
            },
        };
    }

    async init(options) {
        await super.init(options);
        this.availableDatasets = {
            'tss': {label: 'TSS'},
            'duration': {label: this.LM('analysis_time')},
            'distance': {label: this.LM('analysis_distance')},
            'energy': {label: this.LM('analysis_energy')},
        };
        const distStepSize = L.distanceFormatter.unitSystem === 'imperial' ? 1609.344 * 10 : 10000;
        this.setChartConfig({
            type: 'bar',
            options: {
                scales: {
                    xAxes: [{
                        stacked: true,
                        offset: true,
                    }],
                    yAxes: [{
                        id: 'tss',
                        scaleLabel: {labelString: 'TSS'},
                        ticks: {min: 0, maxTicksLimit: 6},
                    }, {
                        id: 'duration',
                        position: 'right',
                        gridLines: {display: false},
                        ticks: {
                            min: 0,
                            suggestedMax: 5 * 3600,
                            stepSize: 3600,
                            maxTicksLimit: 7,
                            callback: v => H.duration(v, {maxPeriod: 3600, minPeriod: 3600}),
                        }
                    }, {
                        id: 'distance',
                        position: 'right',
                        gridLines: {display: false},
                        ticks: {
                            min: 0,
                            stepSize: distStepSize,
                            maxTicksLimit: 7,
                            callback: v => H.distance(v, 0, {suffix: true}),
                        },
                    }, {
                        id: 'energy',
                        position: 'right',
                        gridLines: {display: false},
                        ticks: {
                            min: 0,
                            maxTicksLimit: 6,
                            callback: v => humanKJ(v),
                        },
                    }]
                }
            }
        });
    }

    updateChart() {
        const metricData = this.metricData;
        this.$('.metric-display').text(this.pageView.getMetricLocale(this.range.metric));
        const disabled = this.getPrefs('disabledDatasets', {});
        let predictions;
        let predictionDays;
        if (D.tomorrow() <= this.range.end && metricData.length) {
            const remaining = (this.range.end - Date.now()) / DAY;
            predictionDays = Math.round((this.range.end - metricData[metricData.length - 1].date) / DAY);
            const weighting = Math.min(predictionDays, this.daily.length);
            const avgKJ = sauce.perf.expWeightedAvg(weighting, this.daily.map(x => x.kj));
            const avgTSS = sauce.perf.expWeightedAvg(weighting, this.daily.map(x => x.tss));
            const avgDuration = sauce.perf.expWeightedAvg(weighting, this.daily.map(x => x.duration));
            const avgDistance = sauce.perf.expWeightedAvg(weighting, this.daily.map(x => x.distance));
            predictions = {
                tss: !disabled.tss && metricData.map((b, i) => ({
                    b,
                    x: b.date,
                    y: i === metricData.length - 1 ? avgTSS * remaining : null,
                })),
                duration: !disabled.duration && metricData.map((b, i) => ({
                    b,
                    x: b.date,
                    y: i === metricData.length - 1 ? avgDuration * remaining : null,
                })),
                distance: !disabled.distance && metricData.map((b, i) => ({
                    b,
                    x: b.date,
                    y: i === metricData.length - 1 ? avgDistance * remaining : null,
                })),
                energy: !disabled.energy && metricData.map((b, i) => ({
                    b,
                    x: b.date,
                    y: i === metricData.length - 1 ? avgKJ * remaining : null,
                }))
            };
        }
        const commonOptions = {
            borderWidth: 1
        };
        const datasets = [];
        if (!disabled.tss) {
            datasets.push({
                id: 'tss',
                label: this.availableDatasets.tss.label,
                backgroundColor: '#1d86cdd0',
                borderColor: '#0d76bdf0',
                hoverBackgroundColor: '#0d76bd',
                hoverBorderColor: '#0d76bd',
                yAxisID: 'tss',
                stack: 'tss',
                tooltipFormat: (x, i) => {
                    const tss = Math.round(x).toLocaleString();
                    const tssDay = Math.round(x / metricData[i].days).toLocaleString();
                    const tips = [`${tss} <small>(${tssDay}/d)</small>`];
                    if (predictions && i === metricData.length - 1) {
                        const ptssRaw = predictions.tss[i].y + x;
                        const ptss = Math.round(ptssRaw).toLocaleString();
                        const ptssDay = Math.round(ptssRaw / predictionDays).toLocaleString();
                        tips.push(`${this.LM('predicted')}: <b>~${ptss} <small>(${ptssDay}/d)</small></b>`);
                    }
                    return tips;
                },
                data: metricData.map((b, i) => ({b, x: b.date, y: b.tssSum})),
            });
        }
        if (!disabled.duration) {
            datasets.push({
                id: 'duration',
                label: this.availableDatasets.duration.label,
                backgroundColor: '#fc7d0bd0',
                borderColor: '#dc5d00f0',
                hoverBackgroundColor: '#ec6d00',
                hoverBorderColor: '#dc5d00',
                yAxisID: 'duration',
                stack: 'duration',
                tooltipFormat: (x, i) => {
                    const tips = [H.duration(x, {maxPeriod: 3600, minPeriod: 3600, digits: 1, html: true})];
                    if (predictions && i === metricData.length - 1) {
                        const pdur = H.duration(predictions.duration[i].y + x,
                            {maxPeriod: 3600, minPeriod: 3600, digits: 1, html: true});
                        tips.push(`${this.LM('predicted')}: <b>~${pdur}</b>`);
                    }
                    return tips;
                },
                data: metricData.map((b, i) => ({b, x: b.date, y: b.duration})),
            });
        }
        if (!disabled.distance) {
            datasets.push({
                id: 'distance',
                label: this.availableDatasets.distance.label,
                backgroundColor: '#244d',
                borderColor: '#022f',
                hoverBackgroundColor: '#133',
                hoverBorderColor: '#022',
                yAxisID: 'distance',
                stack: 'distance',
                tooltipFormat: (x, i) => {
                    const tips = [H.distance(x, 0, {suffix: true, html: true})];
                    if (predictions && i === metricData.length - 1) {
                        const pdist = H.distance(predictions.distance[i].y + x, 0,
                            {suffix: true, html: true});
                        tips.push(`${this.LM('predicted')}: <b>~${pdist}</b>`);
                    }
                    return tips;
                },
                data: metricData.map((b, i) => ({b, x: b.date, y: b.distance})),
            });
        }
        if (!disabled.energy) {
            datasets.push({
                id: 'energy',
                label: this.availableDatasets.energy.label,
                backgroundColor: '#8ccd6cd0',
                borderColor: '#7cbd5cf0',
                hoverBackgroundColor: '#7cbd5c',
                hoverBorderColor: '#7cbd5c',
                yAxisID: 'energy',
                stack: 'energy',
                tooltipFormat: (x, i) => {
                    const kjDay = H.number(x / metricData[i].days);
                    const tips = [`${humanKJ(x, {html: true})} <small>(${kjDay}/d)</small>`];
                    if (predictions && i === metricData.length - 1) {
                        const pkj = predictions.energy[i].y + x;
                        const pkjDay = H.number(pkj / predictionDays);
                        tips.push(`${this.LM('predicted')}: <b>~${humanKJ(pkj, {html: true})} ` +
                            `<small>(${pkjDay}/d)</small></b>`);
                    }
                    return tips;
                },
                data: metricData.map((b, i) => ({b, x: b.date, y: b.kj})),
            });
        }
        if (predictions && predictions.tss) {
            datasets.push({
                id: 'tss',
                backgroundColor: '#1d86cd30',
                borderColor: '#0d76bd50',
                hoverBackgroundColor: '#0d76bd60',
                hoverBorderColor: '#0d76bd60',
                yAxisID: 'tss',
                stack: 'tss',
                data: predictions.tss,
            });
        }
        if (predictions && predictions.duration) {
            datasets.push({
                id: 'duration',
                backgroundColor: '#fc7d0b30',
                borderColor: '#dc5d0050',
                hoverBackgroundColor: '#ec6d0060',
                hoverBorderColor: '#dc5d0060',
                yAxisID: 'duration',
                stack: 'duration',
                data: predictions.duration,
            });
        }
        if (predictions && predictions.distance) {
            datasets.push({
                id: 'distance',
                backgroundColor: '#2443',
                borderColor: '#0225',
                hoverBackgroundColor: '#1336',
                hoverBorderColor: '#0226',
                yAxisID: 'distance',
                stack: 'distance',
                data: predictions.distance,
            });
        }
        if (predictions && predictions.energy) {
            datasets.push({
                id: 'energy',
                backgroundColor: '#8ccd6c50',
                borderColor: '#7cbd5c50',
                hoverBackgroundColor: '#7cbd5c60',
                hoverBorderColor: '#7cbd5c60',
                yAxisID: 'energy',
                stack: 'energy',
                data: predictions.energy,
            });
        }
        this.chart.data.datasets = datasets.map(x => Object.assign({}, commonOptions, x));
        this.chart.update();
    }
}


export class ElevationChartView extends charts.ActivityTimeRangeChartView {
    static uuid = 'c9aaaca7-f567-4d34-ab4f-ff0eabc9c406';
    static tpl = 'performance/fitness/elevation.html';
    static typeLocaleKey = 'performance_elevation_type';
    static nameLocaleKey = 'performance_elevation_name';
    static descLocaleKey = 'performance_elevation_desc';
    static localeKeys = ['/analysis_gain', ...super.localeKeys];

    async init(options) {
        const thousandFeet = 1609.344 / 5280 * 100;
        const stepSize = L.elevationFormatter.unitSystem === 'imperial' ? thousandFeet : 1000;
        await super.init(options);
        this.availableDatasets = {
            'elevation': {label: this.LM('analysis_gain')},
        };
        this.setChartConfig({
            options: {
                elements: {
                    line: {
                        fill: true,
                        backgroundColor: '#8f8782e0',
                        borderColor: '#6f6762f0',
                        cubicInterpolationMode: 'monotone',
                    }
                },
                scales: {
                    yAxes: [{
                        id: 'elevation',
                        scaleLabel: {labelString: this.LM('analysis_gain')},
                        ticks: {
                            min: 0,
                            maxTicksLimit: 8,
                            stepSize,
                            callback: v => H.elevation(v, {suffix: true}),
                        },
                    }]
                },
                tooltips: {
                    intersect: false,
                },
            }
        });
    }

    updateChart() {
        let gain = 0;
        const days = this.range.days;
        const lineWidth = days > 366 ? 0.66 : days > 60 ? 1 : 1.25;
        const disabled = this.getPrefs('disabledDatasets', {});
        const datasets = [];
        if (!disabled.elevation) {
            datasets.push({
                id: 'elevation',
                label: this.availableDatasets.elevation.label,
                borderWidth: lineWidth,
                yAxisID: 'elevation',
                tooltipFormat: x => H.elevation(x, {suffix: true, html: true}),
                data: this.daily.map(b => {
                    gain += b.altGain;
                    return {b, x: b.date, y: gain};
                }),
            });
        }
        this.chart.data.datasets = datasets;
        this.chart.update();
    }
}


export class AthleteStatsChartView extends charts.ActivityTimeRangeChartView {
    static uuid = '41f40c5a-fbe3-4f2d-a3ba-7cbc0dba922d';
    static tpl = 'performance/fitness/athlete-stats-chart.html';
    static typeLocaleKey = 'performance_athlete_chart_type';
    static nameLocaleKey = 'performance_athlete_chart_name';
    static descLocaleKey = 'performance_athlete_chart_desc';
    static localeKeys = ['/analysis_weight', ...super.localeKeys];

    async init(options) {
        await super.init(options);
        this.availableDatasets = {
            'weight': {label: this.LM('analysis_weight')},
            'ftp': {label: 'FTP'},
        };
        this.setChartConfig({
            options: {
                elements: {
                    point: {
                        pointStyle: 'circle',
                    },
                    line: {
                        cubicInterpolationMode: 'monotone',
                    }
                },
                scales: {
                    yAxes: [{
                        id: 'weight',
                        scaleLabel: {labelString: this.LM('analysis_weight'), display: true},
                        ticks: {
                            maxTicksLimit: 7,
                            stepSize: L.weightFormatter.unitSystem === 'imperial' ? 10 / 2.20462 : 10,
                            callback: v => H.weight(v, {suffix: true, precision: 0}),
                            beginAtZero: false,
                        },
                    }, {
                        id: 'ftp',
                        scaleLabel: {labelString: 'FTP', display: true},
                        position: 'right',
                        gridLines: {display: false},
                        ticks: {
                            maxTicksLimit: 7,
                            stepSize: 10,
                            callback: v => humanWatts(v),
                            beginAtZero: false,
                        },
                    }]
                },
                tooltips: {
                    intersect: false,
                },
            }
        });
    }

    updateChart() {
        const disabled = this.getPrefs('disabledDatasets', {});
        const datasets = [];
        if (!disabled.weight) {
            datasets.push({
                id: 'weight',
                label: this.availableDatasets.weight.label,
                yAxisID: 'weight',
                backgroundColor: '#16a7',
                borderColor: '#059f',
                tooltipFormat: x => x ? H.weight(x, {precision: 2, suffix: true, html: true}) : '-',
                data: this.metricData.map(b => {
                    return {
                        b,
                        x: b.date,
                        y: b.activities.length ?
                            roundAvg(b.activities.map(x => getAthleteWeightAt(this.athlete, x.ts)), 4) :
                            roundNumber(getAthleteWeightAt(this.athlete, b.date), 4),
                    };
                }),
            });
        }
        if (!disabled.ftp) {
            datasets.push({
                id: 'ftp',
                label: this.availableDatasets.ftp.label,
                yAxisID: 'ftp',
                backgroundColor: '#e347',
                borderColor: '#d23f',
                tooltipFormat: x => x ? humanWatts(x, {html: true}) : '-',
                data: this.metricData.map(b => {
                    return {
                        b,
                        x: b.date,
                        y: b.activities.length ?
                            roundAvg(b.activities.map(x => getAthleteFTPAt(this.athlete, x.ts)), 4) :
                            roundNumber(getAthleteFTPAt(this.athlete, b.date), 4),
                    };
                }),
            });
        }

        this.chart.data.datasets = datasets;
        this.chart.update();
    }
}



export const PanelViews = [
    TrainingChartView,
    ActivityStatsChartView,
    ElevationChartView,
    ZoneTimeChartView,
    AthleteStatsChartView,
];


class FitnessMainView extends views.MainView {
    static tpl = 'performance/fitness/main.html';

    get availablePanelViews() {
        return [...PanelViews, ...peaks.PanelViews, ...views.PanelViews];
    }

    get defaultPrefs() {
        return {
            ...super.defaultPrefs,
            panels: [{
                id: 'panel-default-fitness-training-load-0',
                view: 'a6e7bb31-7860-4946-91e5-da4c82c0a3f4',
            }, {
                id: 'panel-default-fitness-activity-stats-0',
                view: '1b087d9a-d6ad-4c95-98c7-0c4b565edd29',
            }, {
                id: 'panel-default-fitness-zonetimes-0',
                view: 'bb297504-5d68-4f69-b055-5fbabac4651a',
            }, {
                id: 'panel-default-fitness-elevation-0',
                view: 'c9aaaca7-f567-4d34-ab4f-ff0eabc9c406',
            }]
        };
    }
}


export default async function load({athletes, router, $page}) {
    self.pv = new views.PageView({athletes, router, MainView: FitnessMainView, el: $page});
    await self.pv.render();
}
